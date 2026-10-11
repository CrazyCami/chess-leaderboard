"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type GameResult = "white_win" | "draw" | "black_win";
type AdminAction = "approved" | "rejected" | "corrected_result";
type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
};
type PendingGame = {
  id: string;
  source: "chess_com" | "manual";
  source_game_url: string | null;
  white_player_id: string;
  black_player_id: string;
  result: GameResult | null;
  white_source_result: string | null;
  black_source_result: string | null;
  played_at: string;
  time_control: string;
  rules: string;
};
type PlayerName = { id: string; display_name: string };
type WorkflowState = "checking" | "signed_out" | "denied" | "ready";

const SESSION_KEY = "school-chess-league-admin-session";
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AuthSession>;
  return typeof candidate.access_token === "string"
    && typeof candidate.refresh_token === "string"
    && typeof candidate.expires_at === "number"
    && typeof candidate.user?.id === "string";
}

function sessionFromAuthResponse(value: unknown): AuthSession {
  if (typeof value !== "object" || value === null) {
    throw new Error("Supabase returned an invalid authentication response.");
  }
  const candidate = value as Partial<AuthSession> & { expires_in?: number };
  if (
    typeof candidate.access_token !== "string"
    || typeof candidate.refresh_token !== "string"
    || typeof candidate.expires_in !== "number"
    || typeof candidate.user?.id !== "string"
  ) {
    throw new Error("Supabase returned an invalid authentication session.");
  }
  return {
    access_token: candidate.access_token,
    refresh_token: candidate.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + candidate.expires_in,
    user: { id: candidate.user.id },
  };
}

function messageFromBody(body: string, status: number): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "msg" in parsed && typeof parsed.msg === "string") {
      return parsed.msg;
    }
    if (typeof parsed === "object" && parsed !== null && "message" in parsed && typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    if (body.trim()) return body;
  }
  return `Supabase returned HTTP ${status}.`;
}

async function request(path: string, accessToken?: string, init: RequestInit = {}): Promise<unknown> {
  if (!projectUrl || !publishableKey) {
    throw new Error("Set the Supabase project URL and publishable key before using admin review.");
  }

  const response = await fetch(`${projectUrl}${path}`, {
    ...init,
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(messageFromBody(await response.text(), response.status));
  if (response.status === 204) return null;
  return response.json();
}

export function AdminReviewPanel() {
  const [workflowState, setWorkflowState] = useState<WorkflowState>("checking");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [games, setGames] = useState<PendingGame[]>([]);
  const [players, setPlayers] = useState<Map<string, string>>(new Map());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [corrections, setCorrections] = useState<Record<string, GameResult | "">>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const saveSession = useCallback((nextSession: AuthSession | null) => {
    setSession(nextSession);
    if (nextSession) localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    else localStorage.removeItem(SESSION_KEY);
  }, []);

  const refreshSession = useCallback(async (current: AuthSession): Promise<AuthSession> => {
    const value = await request("/auth/v1/token?grant_type=refresh_token", undefined, {
      method: "POST",
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    });
    const refreshed = sessionFromAuthResponse(value);
    saveSession(refreshed);
    return refreshed;
  }, [saveSession]);

  const getFreshSession = useCallback(async (current: AuthSession): Promise<AuthSession> => {
    if (current.expires_at > Math.floor(Date.now() / 1000) + 30) return current;
    return refreshSession(current);
  }, [refreshSession]);

  const loadQueue = useCallback(async (current: AuthSession) => {
    const activeSession = await getFreshSession(current);
    const [rawGames, rawPlayers] = await Promise.all([
      request(
        "/rest/v1/games?select=id,source,source_game_url,white_player_id,black_player_id,result,white_source_result,black_source_result,played_at,time_control,rules&review_status=eq.pending&order=played_at.asc,id.asc",
        activeSession.access_token,
      ),
      request(
        "/rest/v1/players?select=id,display_name",
        activeSession.access_token,
      ),
    ]);
    if (!Array.isArray(rawGames) || !Array.isArray(rawPlayers)) {
      throw new Error("Supabase returned an invalid admin review response.");
    }
    setGames(rawGames as PendingGame[]);
    setPlayers(new Map((rawPlayers as PlayerName[]).map((player) => [player.id, player.display_name])));
    setWorkflowState("ready");
    setError(null);
  }, [getFreshSession]);

  const verifyAndLoad = useCallback(async (candidate: AuthSession) => {
    setWorkflowState("checking");
    try {
      const activeSession = await getFreshSession(candidate);
      const isAdmin = await request("/rest/v1/rpc/is_league_admin", activeSession.access_token, {
        method: "POST",
        body: "{}",
      });
      if (isAdmin !== true) {
        saveSession(null);
        setWorkflowState("denied");
        return;
      }
      await loadQueue(activeSession);
    } catch (cause) {
      saveSession(null);
      setWorkflowState("signed_out");
      setError(cause instanceof Error ? cause.message : "Could not verify the admin account.");
    }
  }, [getFreshSession, loadQueue, saveSession]);

  useEffect(() => {
    const stored = localStorage.getItem(SESSION_KEY);
    if (!stored) {
      setWorkflowState("signed_out");
      return;
    }
    try {
      const candidate: unknown = JSON.parse(stored);
      if (!isAuthSession(candidate)) throw new Error("Saved admin session is invalid.");
      setSession(candidate);
      void verifyAndLoad(candidate);
    } catch (cause) {
      localStorage.removeItem(SESSION_KEY);
      setWorkflowState("signed_out");
      setError(cause instanceof Error ? cause.message : "Saved admin session is invalid.");
    }
  }, [verifyAndLoad]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setWorkflowState("checking");
    try {
      const value = await request("/auth/v1/token?grant_type=password", undefined, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      const candidate = sessionFromAuthResponse(value);
      saveSession(candidate);
      setPassword("");
      await verifyAndLoad(candidate);
    } catch (cause) {
      setWorkflowState("signed_out");
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    }
  }

  async function decide(game: PendingGame, action: AdminAction) {
    if (!session) return;
    const correctedResult = corrections[game.id];
    const reason = reasons[game.id]?.trim();
    if (!reason) {
      setError("Enter a decision reason before saving the review.");
      return;
    }
    if (action === "corrected_result" && !correctedResult) {
      setError("Choose the verified result before correcting this game.");
      return;
    }
    setBusyGameId(game.id);
    setError(null);
    setNotice(null);
    try {
      const activeSession = await getFreshSession(session);
      await request("/rest/v1/rpc/review_league_game", activeSession.access_token, {
        method: "POST",
        body: JSON.stringify({
          p_request_id: crypto.randomUUID(),
          p_game_id: game.id,
          p_action: action,
          p_reason: reason,
          p_corrected_result: action === "corrected_result" ? correctedResult : null,
        }),
      });
      setNotice("Decision recorded. Standings have been recalculated.");
      await loadQueue(activeSession);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record the decision.");
    } finally {
      setBusyGameId(null);
    }
  }

  async function signOut() {
    const currentSession = session;
    saveSession(null);
    setGames([]);
    setWorkflowState("signed_out");
    setNotice(null);
    setError(null);
    if (currentSession) {
      try {
        await request("/auth/v1/logout", currentSession.access_token, { method: "POST" });
      } catch (cause) {
        setError(cause instanceof Error ? `Signed out locally, but Supabase could not revoke the session: ${cause.message}` : "Signed out locally, but Supabase could not revoke the session.");
      }
    }
  }

  if (workflowState === "checking") {
    return <p className="connection-message" role="status">Checking admin access…</p>;
  }

  if (workflowState === "denied") {
    return (
      <section className="admin-panel">
        <h2>Admin access required</h2>
        <p role="alert">This signed-in account is not listed as a league admin.</p>
        <button type="button" onClick={() => { saveSession(null); setWorkflowState("signed_out"); }}>Sign in with another account</button>
      </section>
    );
  }

  if (workflowState === "signed_out") {
    return (
      <section className="admin-panel">
        <h2>Admin sign-in</h2>
        <p>Use a school-approved account already provisioned as a league admin.</p>
        {!projectUrl || !publishableKey ? (
          <p className="connection-message" role="alert">
            Set the Supabase project URL and publishable key to enable admin sign-in.
          </p>
        ) : (
          <form className="admin-sign-in" onSubmit={signIn}>
            <label htmlFor="admin-email">Email</label>
            <input id="admin-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            <label htmlFor="admin-password">Password</label>
            <input id="admin-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            <button type="submit">Sign in</button>
          </form>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="admin-panel" aria-labelledby="review-heading">
      <div className="admin-panel-heading">
        <div>
          <h2 id="review-heading">Pending games</h2>
          <p>{games.length} awaiting review</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => void signOut()}>Sign out</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {games.length === 0 ? (
        <p className="connection-message">No games are waiting for review.</p>
      ) : (
        <ul className="review-list">
          {games.map((game) => (
            <li className="review-card" key={game.id}>
              <div className="review-game-heading">
                <h3>{players.get(game.white_player_id) ?? game.white_player_id} vs. {players.get(game.black_player_id) ?? game.black_player_id}</h3>
                <time dateTime={game.played_at}>{new Date(game.played_at).toLocaleString()}</time>
              </div>
              <p>
                {game.source === "chess_com" ? "Chess.com" : "Manual"} · {game.rules} · {game.time_control}
                {" · "}White: {game.white_source_result ?? "unknown"}, Black: {game.black_source_result ?? "unknown"}
              </p>
              {game.source_game_url && <a href={game.source_game_url} target="_blank" rel="noreferrer">Review source game (opens a new tab)</a>}
              <label htmlFor={`reason-${game.id}`}>Decision reason (required)</label>
              <textarea id={`reason-${game.id}`} rows={2} maxLength={1000} value={reasons[game.id] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [game.id]: event.target.value }))} />
              {game.result === null && (
                <p>This result is unclear. Correct it to the verified outcome or reject the game.</p>
              )}
              <div className="review-actions">
                {game.result !== null && <button type="button" disabled={busyGameId === game.id} onClick={() => void decide(game, "approved")}>Approve {game.result.replace("_", " ")}</button>}
                <button type="button" className="secondary-button" disabled={busyGameId === game.id} onClick={() => void decide(game, "rejected")}>Reject</button>
                <label htmlFor={`correction-${game.id}`}>Correct result</label>
                <select id={`correction-${game.id}`} value={corrections[game.id] ?? ""} onChange={(event) => setCorrections((current) => ({ ...current, [game.id]: event.target.value as GameResult | "" }))}>
                  <option value="">Choose result</option>
                  <option value="white_win">White wins</option>
                  <option value="draw">Draw</option>
                  <option value="black_win">Black wins</option>
                </select>
                <button type="button" className="secondary-button" disabled={busyGameId === game.id || !corrections[game.id]} onClick={() => void decide(game, "corrected_result")}>Save correction</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
