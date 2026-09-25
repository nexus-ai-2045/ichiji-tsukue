export type Hit = {
  url: string;
  title: string;
  date: string;
  kind: "paper" | "git" | "announce";
  upstream: string;
};

export type DeskAnswer = {
  id: string;
  query: string;
  answer: string;
  hits: Hit[];
  cacheHit: boolean;
  model: string | null;
  upstream: string;
  tokensLeft: number;
  vote: string | null;
};

const FREE_PER_DAY = 3;
const CACHE_MS = 6 * 60 * 60 * 1000;
const GATE = "preview-login";

const HOSTS = {
  github: "https://api.github.com/search/repositories",
  hn: "https://hn.algolia.com/api/v1/search",
} as const;

function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 180);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function getText(url: string, headers?: HeadersInit): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function getJson<T>(url: string, headers?: HeadersInit): Promise<T | null> {
  const text = await getText(url, headers);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

type OpenAlexWork = {
  display_name?: string;
  publication_date?: string;
  ids?: { doi?: string };
  open_access?: { oa_url?: string | null };
};
type OpenAlex = { results?: OpenAlexWork[] };

async function fromPapers(query: string): Promise<{ hits: Hit[]; notes: string[] }> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=4&select=display_name,publication_date,ids,open_access`;
  const data = await getJson<OpenAlex>(url, { "User-Agent": "light-fact-search" });
  const hits: Hit[] = [];
  const notes: string[] = [];
  for (const work of data?.results ?? []) {
    if (!work.display_name) continue;
    const oa = work.open_access?.oa_url ?? "";
    const doi = work.ids?.doi ?? "";
    const paperUrl = oa.includes("arxiv.org") ? oa : doi.startsWith("http") ? doi : "";
    if (!paperUrl) continue;
    const date = work.publication_date ?? "";
    hits.push({ url: paperUrl, title: work.display_name, date, kind: "paper", upstream: "openalex" });
    notes.push(`${work.display_name} (${date})\n${paperUrl}`);
  }
  return { hits, notes };
}

type GhRepo = { full_name?: string; html_url?: string; description?: string; pushed_at?: string };
type GhSearch = { items?: GhRepo[] };
type GhRelease = { html_url?: string; name?: string; tag_name?: string; published_at?: string };

async function fromGithub(query: string): Promise<{ hits: Hit[]; notes: string[] }> {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "light-fact-search",
  };
  const data = await getJson<GhSearch>(
    `${HOSTS.github}?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=3`,
    headers,
  );
  const hits: Hit[] = [];
  const notes: string[] = [];
  for (const repo of (data?.items ?? []).slice(0, 2)) {
    if (!repo.full_name || !repo.html_url) continue;
    const release = await getJson<GhRelease>(
      `https://api.github.com/repos/${repo.full_name}/releases/latest`,
      headers,
    );
    if (release?.html_url && release.tag_name) {
      const date = (release.published_at ?? repo.pushed_at ?? "").slice(0, 10);
      const title = `${repo.full_name} ${release.tag_name}${release.name ? ` ${release.name}` : ""}`;
      hits.push({ url: release.html_url, title, date, kind: "git", upstream: "github" });
      notes.push(`${title} (${date})\n${release.html_url}`);
    }
  }
  return { hits, notes };
}

function dedupe(groups: Hit[][]): Hit[] {
  const byUrl = new Map<string, Hit>();
  for (const hit of groups.flat()) {
    const prev = byUrl.get(hit.url);
    if (!prev || hit.date > prev.date) byUrl.set(hit.url, hit);
  }
  return [...byUrl.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
}

export async function gather(query: string): Promise<{ hits: Hit[]; notes: string[]; upstream: string }> {
  const [papers, github] = await Promise.all([fromPapers(query), fromGithub(query)]);
  const hits = dedupe([papers.hits, github.hits]);
  const used = [papers.hits.length ? "openalex" : "", github.hits.length ? "github" : ""].filter(Boolean);
  return {
    hits,
    notes: [...papers.notes, ...github.notes].slice(0, 6),
    upstream: used.join("+") || "none",
  };
}

export const deskConstants = { FREE_PER_DAY, CACHE_MS, GATE, todayJst };
