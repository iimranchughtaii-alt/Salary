import projectFiles from 'virtual:project-files';

export interface GitHubPushParams {
  owner?: string;
  repo: string;
  branch?: string;
  token: string;
  commitMessage?: string;
  skipWorkflow?: boolean;
  onProgress?: (message: string) => void;
}

export interface GitHubPushResult {
  owner: string;
  repo: string;
  branch: string;
  commitSha: string;
  commitUrl: string;
  actionsUrl: string;
  fileCount: number;
  skippedWorkflow: boolean;
}

function parseRepoInputs(rawOwner: string | undefined, rawRepo: string) {
  let owner = (rawOwner || '').trim();
  let repo = (rawRepo || '').trim();

  // Support pasting full https://github.com/owner/repo URLs into either field
  const urlMatch = repo.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (urlMatch) {
    owner = urlMatch[1];
    repo = urlMatch[2].replace(/\.git$/i, '');
  } else if (repo.includes('/')) {
    const parts = repo.split('/').filter(Boolean);
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts[1].replace(/\.git$/i, '');
    }
  }

  repo = repo.replace(/\.git$/i, '');
  owner = owner.replace(/^@/, '');

  // Never use placeholder string as a real GitHub username
  if (owner.toLowerCase() === 'your-username') {
    owner = '';
  }

  return { owner, repo };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function ghRequest<T>(
  stepLabel: string,
  url: string,
  token: string,
  options: RequestInit = {}
): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const json = (await res.json()) as {
        message?: string;
        errors?: { message?: string }[];
      };
      if (json?.message) {
        detail = json.message;
        if (Array.isArray(json.errors) && json.errors[0]?.message) {
          detail += `: ${json.errors[0].message}`;
        }
      }
    } catch {
      // Keep status message
    }
    const err = new Error(`${stepLabel}: ${detail}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as T;
  return { data, headers: res.headers };
}

export async function pushProjectToGitHub({
  owner: rawOwner,
  repo: rawRepo,
  branch: rawBranch,
  token: rawToken,
  commitMessage,
  skipWorkflow = false,
  onProgress,
}: GitHubPushParams): Promise<GitHubPushResult> {
  const token = rawToken.trim();
  if (!token) {
    throw new Error('Please paste your GitHub Token first.');
  }

  const parsed = parseRepoInputs(rawOwner, rawRepo);
  const cleanRepo = parsed.repo;
  if (!cleanRepo) {
    throw new Error('Please enter a Repository Name (e.g. Salary).');
  }

  // Step 1: Verify token and get exact authenticated GitHub username
  onProgress?.('Verifying GitHub token...');
  let authLogin = '';
  let oauthScopes = '';
  try {
    const { data: userData, headers } = await ghRequest<{ login: string }>(
      'Token Check',
      'https://api.github.com/user',
      token
    );
    authLogin = userData.login;
    oauthScopes = headers.get('x-oauth-scopes') || '';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token check failed';
    throw new Error(
      `${msg}. Please generate a fresh token using Button 1.`
    );
  }

  // Check classic token scopes proactively if header is present
  if (oauthScopes) {
    const scopeList = oauthScopes.split(',').map((s) => s.trim().toLowerCase());
    const hasRepo = scopeList.includes('repo') || scopeList.includes('public_repo');
    if (!hasRepo) {
      throw new Error(
        'Your token is missing the "repo" permission. Create a token with Button 1 (repo + workflow checked).'
      );
    }
    if (!skipWorkflow && !scopeList.includes('workflow')) {
      throw new Error(
        'Your token is missing the "workflow" permission needed to push .github/workflows/build-apk.yml.'
      );
    }
  }

  // Step 2: Locate or create repository under authenticated user (or specified org)
  let cleanOwner = parsed.owner || authLogin;
  let targetBranch = (rawBranch || '').trim() || 'main';

  const checkRepo = async (ownerCandidate: string) => {
    const url = `https://api.github.com/repos/${encodeURIComponent(
      ownerCandidate
    )}/${encodeURIComponent(cleanRepo)}`;
    return fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
      },
    });
  };

  onProgress?.(`Checking ${cleanOwner}/${cleanRepo}...`);
  let repoCheck = await checkRepo(cleanOwner);

  // If typed username was wrong/display name, fall back to authenticated login automatically
  if (repoCheck.status === 404 && cleanOwner.toLowerCase() !== authLogin.toLowerCase()) {
    onProgress?.(`Checking ${authLogin}/${cleanRepo}...`);
    cleanOwner = authLogin;
    repoCheck = await checkRepo(cleanOwner);
  }

  if (repoCheck.status === 404) {
    onProgress?.(`Creating repository ${authLogin}/${cleanRepo}...`);
    const { data: created } = await ghRequest<{
      default_branch?: string;
      owner?: { login?: string };
    }>('Create Repo', 'https://api.github.com/user/repos', token, {
      method: 'POST',
      body: JSON.stringify({
        name: cleanRepo,
        private: false,
        auto_init: true,
        description: 'Biweekly Salary Calculator (15 Days) - Offline PWA & Android APK',
      }),
    });
    cleanOwner = created.owner?.login || authLogin;
    if (created.default_branch && !rawBranch?.trim()) {
      targetBranch = created.default_branch;
    }
    await delay(1500);
  } else if (!repoCheck.ok) {
    const errJson = (await repoCheck.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `Check Repo (${cleanOwner}/${cleanRepo}): ${errJson.message || `HTTP ${repoCheck.status}`}`
    );
  } else {
    const repoInfo = (await repoCheck.json()) as {
      default_branch?: string;
      owner?: { login?: string };
    };
    if (repoInfo.owner?.login) {
      cleanOwner = repoInfo.owner.login;
    }
    if (repoInfo.default_branch && !rawBranch?.trim()) {
      targetBranch = repoInfo.default_branch;
    }
  }

  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(
    cleanOwner
  )}/${encodeURIComponent(cleanRepo)}`;

  // Step 3: Ensure targetBranch exists (poll briefly after auto_init, or initialize via README.md if empty)
  let parentCommitSha: string | null = null;
  let baseTreeSha: string | null = null;
  const refUrl = `${baseUrl}/git/ref/heads/${encodeURIComponent(targetBranch)}`;

  let refRes: Response | null = null;
  for (let i = 0; i < 3; i++) {
    refRes = await fetch(refUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (refRes.ok) break;
    await delay(800);
  }

  if (!refRes || !refRes.ok) {
    onProgress?.(`Initializing branch "${targetBranch}" on ${cleanOwner}/${cleanRepo}...`);
    const readmeB64 = utf8ToBase64(
      `# ${cleanRepo}\n\nBiweekly Salary Calculator (15 Days) - Offline PWA & Android APK\n`
    );
    const { data: initData } = await ghRequest<{
      commit: { sha: string; tree: { sha: string } };
    }>('Initialize Branch', `${baseUrl}/contents/README.md`, token, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Initialize repository',
        content: readmeB64,
        branch: targetBranch,
      }),
    });
    parentCommitSha = initData.commit.sha;
    baseTreeSha = initData.commit.tree.sha;
    await delay(1000);
  } else {
    const refData = (await refRes.json()) as { object: { sha: string } };
    parentCommitSha = refData.object.sha;
    const { data: commitData } = await ghRequest<{ tree: { sha: string } }>(
      'Read Base Commit',
      `${baseUrl}/git/commits/${parentCommitSha}`,
      token
    );
    baseTreeSha = commitData.tree.sha;
  }

  // Step 4: Upload blobs for project files
  const filesToUpload = skipWorkflow
    ? projectFiles.filter((f) => !f.path.startsWith('.github/'))
    : projectFiles;

  const treeItems: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];

  for (let i = 0; i < filesToUpload.length; i++) {
    const file = filesToUpload[i];
    onProgress?.(`Uploading ${i + 1}/${filesToUpload.length}: ${file.path}`);

    let blobSha = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data: blobResp } = await ghRequest<{ sha: string }>(
          `Upload ${file.path}`,
          `${baseUrl}/git/blobs`,
          token,
          {
            method: 'POST',
            body: JSON.stringify({
              content: file.content,
              encoding: file.encoding,
            }),
          }
        );
        blobSha = blobResp.sha;
        break;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if ((status === 409 || status === 404) && attempt < 2) {
          await delay(1000);
          continue;
        }
        throw err;
      }
    }

    treeItems.push({
      path: file.path,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
    });
  }

  // Step 5: Create tree, commit, and update branch ref
  onProgress?.('Creating commit on GitHub...');
  const { data: treeResp } = await ghRequest<{ sha: string }>(
    'Create Git Tree',
    `${baseUrl}/git/trees`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    }
  );

  const { data: commitResp } = await ghRequest<{ sha: string; html_url: string }>(
    'Create Git Commit',
    `${baseUrl}/git/commits`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        message: commitMessage || 'Push Biweekly Salary Calculator & APK workflow',
        tree: treeResp.sha,
        parents: [parentCommitSha],
      }),
    }
  );

  onProgress?.(`Updating branch "${targetBranch}"...`);
  await ghRequest(
    'Update Branch Ref',
    `${baseUrl}/git/refs/heads/${encodeURIComponent(targetBranch)}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({
        sha: commitResp.sha,
        force: true,
      }),
    }
  );

  return {
    owner: cleanOwner,
    repo: cleanRepo,
    branch: targetBranch,
    commitSha: commitResp.sha,
    commitUrl: commitResp.html_url,
    actionsUrl: `https://github.com/${cleanOwner}/${cleanRepo}/actions`,
    fileCount: filesToUpload.length,
    skippedWorkflow: skipWorkflow,
  };
}
