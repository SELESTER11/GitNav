(function() {
  console.log("GitHub Codebase Navigator: Content script loaded");
  async function getStoredToken() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["github_token"], (result) => {
        resolve(result.github_token || null);
      });
    });
  }
  async function saveToken(token) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ github_token: token }, () => {
        resolve();
      });
    });
  }
  async function getAuthHeaders() {
    const token = await getStoredToken();
    const headers = {
      "Accept": "application/vnd.github.v3+json"
    };
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }
    return headers;
  }
  const CONFIG = {
    CACHE_DURATION: 30 * 60 * 1e3,
    // 30 minutes
    MAX_FILES_IN_GRAPH: 60,
    API_RATE_LIMIT_WARNING: 10,
    MAX_SEARCH_RESULTS: 30,
    MAX_KEY_FILES_PREVIEW: 3
  };
  const GITHUB_API = "https://api.github.com";
  let globalData = null;
  let repoCache = {};
  let rateLimitInterval = null;
  function init() {
    const path = window.location.pathname.split("/").filter((p) => p);
    console.log("Current path:", path);
    if (path.length >= 2) {
      console.log("Valid repo page, injecting button");
      injectButton();
    }
  }
  function injectButton() {
    const existing = document.getElementById("codebase-nav-button");
    if (existing) return;
    const container = document.createElement("div");
    container.id = "codebase-nav-button";
    container.style.cssText = `
        position: fixed !important;
        bottom: 30px !important;
        right: 30px !important;
        z-index: 999999 !important;
      `;
    const button = document.createElement("button");
    button.textContent = "Analyze Codebase";
    button.style.cssText = `
        background: #238636 !important;
        color: #ffffff !important;
        border: none !important;
        padding: 14px 28px !important;
        border-radius: 6px !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      `;
    button.onmouseover = () => button.style.background = "#2ea043 !important";
    button.onmouseout = () => button.style.background = "#238636 !important";
    button.onclick = openSidebar;
    container.appendChild(button);
    document.body.appendChild(container);
    console.log("Button injected successfully");
  }
  async function openSidebar() {
    console.log("Button clicked!");
    const existing = document.getElementById("codebase-navigator-sidebar");
    if (existing) {
      existing.remove();
      return;
    }
    const path = window.location.pathname.split("/").filter((p) => p);
    const owner = path[0];
    const repo = path[1];
    console.log("Opening sidebar for:", owner, "/", repo);
    const sidebar = createSidebar(owner, repo);
    document.body.appendChild(sidebar);
    try {
      const data = await fetchRepoData(owner, repo);
      globalData = data;
      renderSidebar(sidebar, owner, repo, data);
    } catch (error) {
      console.error("Error:", error);
      showError(sidebar, error.message);
    }
  }
  function createSidebar(owner, repo) {
    const sidebar = document.createElement("div");
    sidebar.id = "codebase-navigator-sidebar";
    sidebar.innerHTML = `
        <style>
          #codebase-navigator-sidebar {
            position: fixed;
            top: 0;
            right: 0;
            width: 500px;
            height: 100vh;
            background: #0d1117;
            border-left: 1px solid #30363d;
            box-shadow: -2px 0 12px rgba(0,0,0,0.5);
            z-index: 999998;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #c9d1d9;
          }
          .sidebar-header {
            position: sticky;
            top: 0;
            background: #161b22;
            border-bottom: 1px solid #30363d;
            padding: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 10;
          }
          .sidebar-title {
            font-size: 16px;
            font-weight: 600;
            margin: 0;
            color: #c9d1d9;
          }
          .close-btn {
            background: transparent;
            border: none;
            color: #8b949e;
            font-size: 28px;
            cursor: pointer;
            padding: 0;
            width: 32px;
            height: 32px;
            line-height: 1;
          }
          .close-btn:hover {
            background: #21262d;
            color: #c9d1d9;
            border-radius: 6px;
          }
          .nav-tabs {
            display: flex;
            background: #161b22;
            border-bottom: 1px solid #30363d;
            position: sticky;
            top: 64px;
            z-index: 9;
            overflow-x: auto;
          }
          .nav-tab {
            flex: 1;
            min-width: 70px;
            padding: 10px 6px;
            text-align: center;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            color: #8b949e;
            font-size: 11px;
            font-weight: 500;
            transition: all 0.2s;
            background: transparent;
            border-left: none;
            border-right: none;
            border-top: none;
            white-space: nowrap;
          }
          .nav-tab:hover {
            color: #c9d1d9;
            background: #21262d;
          }
          .nav-tab.active {
            color: #c9d1d9;
            border-bottom-color: #f78166;
            background: #0d1117;
          }
          .tab-content {
            display: none;
            padding: 16px;
          }
          .tab-content.active {
            display: block;
          }
          .loading {
            text-align: center;
            padding: 40px 20px;
            color: #8b949e;
          }
          .spinner {
            border: 3px solid #30363d;
            border-top: 3px solid #58a6ff;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .section {
            margin-bottom: 24px;
          }
          .section-title {
            font-size: 14px;
            font-weight: 600;
            margin: 0 0 12px 0;
            padding-bottom: 8px;
            border-bottom: 1px solid #30363d;
            color: #c9d1d9;
          }
          .stat-box {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
          }
          .stat-row {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            font-size: 13px;
          }
          .stat-label {
            color: #8b949e;
          }
          .stat-value {
            color: #c9d1d9;
            font-weight: 500;
          }
          .file-item {
            padding: 10px 12px;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .file-item:hover {
            background: #21262d;
          }
          .file-name {
            color: #58a6ff;
            font-size: 13px;
            font-weight: 500;
            word-break: break-all;
          }
          .file-path {
            color: #8b949e;
            font-size: 12px;
            margin-top: 4px;
          }
          .file-type-badge {
            display: inline-block;
            padding: 2px 8px;
            background: #21262d;
            border-radius: 3px;
            font-size: 11px;
            color: #8b949e;
            margin-top: 4px;
          }
          .error {
            background: rgba(218, 54, 51, 0.1);
            border: 1px solid #da3633;
            border-radius: 6px;
            padding: 12px;
            color: #da3633;
            font-size: 13px;
          }
          .btn-primary {
            background: #238636;
            color: #ffffff;
            border: none;
            padding: 10px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            width: 100%;
            transition: background 0.2s;
          }
          .btn-primary:hover {
            background: #2ea043;
          }
          .btn-primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .btn-secondary {
            background: #21262d;
            color: #c9d1d9;
            border: 1px solid #30363d;
            padding: 8px 14px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
            margin-right: 8px;
          }
          .btn-secondary:hover {
            background: #30363d;
          }
          .search-input {
            width: 100%;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 10px 12px;
            color: #c9d1d9;
            font-size: 14px;
            font-family: inherit;
            box-sizing: border-box;
          }
          .search-input:focus {
            outline: none;
            border-color: #58a6ff;
            box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.1);
          }
          .search-input::placeholder {
            color: #8b949e;
          }
          .tree-item {
            padding: 6px 8px;
            cursor: pointer;
            border-radius: 4px;
            display: flex;
            align-items: center;
            transition: background 0.1s;
            font-size: 13px;
            user-select: none;
          }
          .tree-item:hover {
            background: #21262d;
          }
          .tree-toggle {
            width: 20px;
            display: inline-block;
            color: #8b949e;
            text-align: center;
            cursor: pointer;
          }
          .tree-icon {
            margin: 0 8px;
            color: #8b949e;
            font-size: 12px;
          }
          .tree-name {
            flex: 1;
            color: #c9d1d9;
          }
          .tree-name.file {
            color: #8b949e;
          }
          .tree-children {
            margin-left: 20px;
            display: none;
          }
          .tree-children.open {
            display: block;
          }
          .onboarding-steps {
            list-style: none;
            padding: 0;
            margin: 0;
            counter-reset: step-counter;
          }
          .onboarding-step {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 12px 12px 12px 52px;
            margin-bottom: 12px;
            position: relative;
            counter-increment: step-counter;
          }
          .onboarding-step::before {
            content: counter(step-counter);
            position: absolute;
            left: 14px;
            top: 14px;
            width: 26px;
            height: 26px;
            background: #238636;
            color: #ffffff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 600;
          }
          .step-title {
            color: #c9d1d9;
            font-size: 13px;
            font-weight: 600;
            margin: 0 0 6px 0;
          }
          .step-file {
            color: #58a6ff;
            font-size: 12px;
            font-family: 'SF Mono', Monaco, Consolas, monospace;
            margin-bottom: 4px;
          }
          .step-command {
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 4px;
            padding: 8px 10px;
            margin-top: 6px;
            color: #c9d1d9;
            font-size: 12px;
            font-family: 'SF Mono', Monaco, Consolas, monospace;
          }
          .progress-bar {
            background: #21262d;
            height: 8px;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 6px;
          }
          .progress-fill {
            background: #58a6ff;
            height: 100%;
            transition: width 0.3s;
          }
          .insight-card {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
          }
          .insight-title {
            font-size: 13px;
            font-weight: 600;
            color: #c9d1d9;
            margin-bottom: 8px;
          }
          .insight-value {
            font-size: 24px;
            font-weight: 700;
            color: #58a6ff;
            margin-bottom: 4px;
          }
          .insight-label {
            font-size: 12px;
            color: #8b949e;
          }
          .copy-btn {
            background: #21262d;
            border: 1px solid #30363d;
            color: #8b949e;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            margin-left: 8px;
          }
          .copy-btn:hover {
            background: #30363d;
            color: #c9d1d9;
          }
          .copy-btn.copied {
            background: #238636;
            color: #ffffff;
            border-color: #238636;
          }
          .dependency-list {
            max-height: 300px;
            overflow-y: auto;
          }
          .dependency-item {
            padding: 8px 10px;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 4px;
            margin-bottom: 6px;
            font-size: 12px;
          }
          .dep-name {
            color: #c9d1d9;
            font-weight: 500;
            font-family: monospace;
          }
          .dep-version {
            color: #8b949e;
            margin-left: 8px;
          }
          .health-score {
            font-size: 48px;
            font-weight: 700;
            text-align: center;
            margin: 20px 0;
          }
          .health-excellent { color: #3fb950; }
          .health-good { color: #58a6ff; }
          .health-fair { color: #d29922; }
          .health-poor { color: #da3633; }
          .commit-item {
            padding: 10px;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            margin-bottom: 8px;
          }
          .commit-message {
            color: #c9d1d9;
            font-size: 13px;
            margin-bottom: 4px;
          }
          .commit-meta {
            color: #8b949e;
            font-size: 11px;
          }
          .contributor-item {
            display: flex;
            align-items: center;
            padding: 10px;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            margin-bottom: 8px;
          }
          .contributor-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin-right: 12px;
          }
          .contributor-info {
            flex: 1;
          }
          .contributor-name {
            color: #c9d1d9;
            font-size: 13px;
            font-weight: 500;
          }
          .contributor-commits {
            color: #8b949e;
            font-size: 11px;
          }
          .tech-badge {
            display: inline-flex;
            align-items: center;
            padding: 6px 12px;
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            margin: 4px;
            font-size: 12px;
            color: #c9d1d9;
          }
          .metric-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 16px;
          }
          .chart-container {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
          }
          .bar-chart {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .bar-item {
            display: flex;
            align-items: center;
            font-size: 12px;
          }
          .bar-label {
            width: 100px;
            color: #8b949e;
          }
          .bar-fill-container {
            flex: 1;
            height: 20px;
            background: #0d1117;
            border-radius: 4px;
            overflow: hidden;
            margin: 0 8px;
          }
          .bar-fill {
            height: 100%;
            background: #58a6ff;
            transition: width 0.3s;
          }
          .bar-value {
            color: #c9d1d9;
            min-width: 40px;
            text-align: right;
          }
          .security-alert {
            background: rgba(218, 54, 51, 0.1);
            border: 1px solid #da3633;
            border-radius: 6px;
            padding: 10px 12px;
            margin-bottom: 8px;
            font-size: 12px;
          }
          .security-alert.medium {
            background: rgba(210, 153, 34, 0.1);
            border-color: #d29922;
          }
          .security-alert.low {
            background: rgba(88, 166, 255, 0.1);
            border-color: #58a6ff;
          }
          .security-alert-title {
            color: #da3633;
            font-weight: 600;
            margin-bottom: 4px;
          }
          .security-alert.medium .security-alert-title {
            color: #d29922;
          }
          .security-alert.low .security-alert-title {
            color: #58a6ff;
          }
          .security-alert-desc {
            color: #8b949e;
          }
          .export-options {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          .export-btn {
            flex: 1;
            min-width: 120px;
          }
            .token-setup {
            background: rgba(88, 166, 255, 0.1);
            border: 1px solid #58a6ff;
            border-radius: 6px;
            padding: 12px;
            margin: 12px 16px;
            font-size: 12px;
          }
          .token-input-group {
            display: flex;
            gap: 8px;
            margin-top: 8px;
          }
          .token-input {
            flex: 1;
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 4px;
            padding: 6px 10px;
            color: #c9d1d9;
            font-size: 12px;
            font-family: monospace;
          }
          .token-status {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
            font-size: 11px;
          }
          .token-status.success { color: #3fb950; }
          .token-status.error { color: #da3633; }
        </style>


        <div class="sidebar-header">
  <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
    <img src="${chrome.runtime.getURL("icons/logo32light.png")}" 
     alt="GitNav Logo" 
     style="width: 32px; height: 32px; border-radius: 6px;" />
    <div style="flex: 1;">
      <h2 class="sidebar-title" style="margin: 0;">${owner}/${repo}</h2>
      <div id="rate-limit-status" style="font-size: 11px; color: #8b949e; margin-top: 4px;"></div>
    </div>
  </div>
  <button class="close-btn" id="close-sidebar">&times;</button>
</div>


        <div id="token-setup-banner" style="display: none;">
          <div class="token-setup">
            <div style="font-weight: 600; margin-bottom: 4px;">🔒 Private Repository Detected</div>
                <div style="color: #8b949e; margin-bottom: 8px;">
                 Add a GitHub token to access private repositories
                    </div>
                        <div class="token-input-group">
                        <input type="password" class="token-input" id="github-token-input" placeholder="ghp_xxxxxxxxxxxx">
                        <button class="btn-secondary" id="save-token-btn">Save</button>
                    </div>
                <div id="token-status" class="token-status" style="display: none;"></div>
                <div style="margin-top: 8px; color: #8b949e;">
              <a href="https://github.com/settings/tokens/new?scopes=repo&description=Codebase%20Navigator" 
                 target="_blank" style="color: #58a6ff; text-decoration: none;">
                Create token →
              </a>
            </div>
          </div>
        </div>

        <div class="nav-tabs">
          <button class="nav-tab active" data-tab="overview">Overview</button>
          <button class="nav-tab" data-tab="visualize">Visualize</button>
          <button class="nav-tab" data-tab="tree">Tree</button>
          <button class="nav-tab" data-tab="search">Search</button>
          <button class="nav-tab" data-tab="insights">Insights</button>
          <button class="nav-tab" data-tab="metrics">Metrics</button>
          <button class="nav-tab" data-tab="tools">Tools</button>
          <button class="nav-tab" data-tab="contributors">Contributors</button>
          <button class="nav-tab" data-tab="dependencies">Deps</button>
          <button class="nav-tab" data-tab="tech">Tech Stack</button>
          <button class="nav-tab" data-tab="security">Security</button>
          <button class="nav-tab" data-tab="about">About</button>
          
        </div>
        <div id="sidebar-main-content">
          <div class="loading">
            <div class="spinner"></div>
            <div>Loading repository data...</div>
          </div>
        </div>
      `;
    sidebar.querySelector("#close-sidebar").onclick = () => {
      if (rateLimitInterval) {
        clearInterval(rateLimitInterval);
        rateLimitInterval = null;
      }
      sidebar.remove();
    };
    const tokenInput = sidebar.querySelector("#github-token-input");
    const saveTokenBtn = sidebar.querySelector("#save-token-btn");
    const tokenStatus = sidebar.querySelector("#token-status");
    if (saveTokenBtn && tokenInput) {
      saveTokenBtn.onclick = async () => {
        const token = tokenInput.value.trim();
        if (!token) {
          tokenStatus.style.display = "flex";
          tokenStatus.className = "token-status error";
          tokenStatus.innerHTML = "❌ Please enter a token";
          return;
        }
        try {
          const headers = { "Authorization": `token ${token}` };
          const test = await fetch(`${GITHUB_API}/user`, { headers });
          if (test.ok) {
            await saveToken(token);
            tokenStatus.style.display = "flex";
            tokenStatus.className = "token-status success";
            tokenStatus.innerHTML = "Token saved! Refreshing...";
            setTimeout(() => {
              location.reload();
            }, 1500);
          } else {
            tokenStatus.style.display = "flex";
            tokenStatus.className = "token-status error";
            tokenStatus.innerHTML = "Invalid token";
          }
        } catch (e) {
          tokenStatus.style.display = "flex";
          tokenStatus.className = "token-status error";
          tokenStatus.innerHTML = "Error validating token";
        }
      };
    }
    return sidebar;
  }
  async function checkRateLimit() {
    try {
      const headers = await getAuthHeaders();
      const rateLimitRes = await fetch(`${GITHUB_API}/rate_limit`, { headers });
      const rateLimit = await rateLimitRes.json();
      if (rateLimit.rate.remaining < CONFIG.API_RATE_LIMIT_WARNING) {
        const resetTime = new Date(rateLimit.rate.reset * 1e3);
        throw new Error(`GitHub API rate limit low. Resets at ${resetTime.toLocaleTimeString()}`);
      }
    } catch (e) {
      console.warn("Could not check rate limit");
    }
  }
  async function fetchRepoData(owner, repo) {
    const cacheKey = `${owner}/${repo}`;
    const now = Date.now();
    if (repoCache[cacheKey] && now - repoCache[cacheKey].timestamp < CONFIG.CACHE_DURATION) {
      console.log("Using cached data for", cacheKey);
      return repoCache[cacheKey].data;
    }
    console.log("Fetching:", `${GITHUB_API}/repos/${owner}/${repo}`);
    try {
      await checkRateLimit();
      const headers = await getAuthHeaders();
      const infoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
      if (!infoRes.ok) {
        if (infoRes.status === 403) {
          const rateLimitRes = await fetch(`${GITHUB_API}/rate_limit`, { headers });
          const rateLimit = await rateLimitRes.json();
          const resetTime = new Date(rateLimit.rate.reset * 1e3);
          const timeLeft = Math.ceil((rateLimit.rate.reset * 1e3 - Date.now()) / 6e4);
          throw new Error(`GitHub API rate limit exceeded. ${timeLeft} minutes remaining. Try again at ${resetTime.toLocaleTimeString()}`);
        } else if (infoRes.status === 404) {
          throw new Error(`Repository ${owner}/${repo} not found or is private. Add a GitHub token if this is a private repository.`);
        } else if (infoRes.status === 401) {
          throw new Error(`Invalid GitHub token. Please check your token in the banner above.`);
        } else {
          throw new Error(`Failed to fetch repository info (Status: ${infoRes.status})`);
        }
      }
      const info = await infoRes.json();
      const defaultBranch = info.default_branch || "main";
      console.log("Default branch:", defaultBranch);
      let treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, { headers });
      if (!treeRes.ok) {
        console.log(`Branch ${defaultBranch} failed, trying alternative...`);
        const altBranch = defaultBranch === "main" ? "master" : "main";
        treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${altBranch}?recursive=1`, { headers });
        if (!treeRes.ok) {
          throw new Error(`Could not fetch repository tree. Tried branches: ${defaultBranch}, ${altBranch}`);
        }
      }
      const [commitsRes, contributorsRes] = await Promise.all([
        fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=30`, { headers }).catch(() => null),
        fetch(`${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=10`, { headers }).catch(() => null)
      ]);
      const tree = await treeRes.json();
      const commits = commitsRes && commitsRes.ok ? await commitsRes.json() : [];
      const contributors = contributorsRes && contributorsRes.ok ? await contributorsRes.json() : [];
      const files = tree.tree.filter((f) => f.type === "blob");
      const folders = tree.tree.filter((f) => f.type === "tree");
      console.log(`✓ Loaded ${files.length} files, ${folders.length} folders`);
      const data = {
        info,
        files,
        folders,
        commits,
        contributors,
        keyFiles: findKeyFiles(tree.tree),
        categorized: categorizeFiles(files),
        fileTree: buildFileTree(tree.tree),
        stats: calculateStats(files, folders, info),
        dependencies: await extractDependencies(files, owner, repo),
        techStack: detectTechStack(files, info),
        metrics: calculateCodeMetrics(files, commits),
        security: analyzeSecurityIssues(files, info)
      };
      repoCache[cacheKey] = {
        data,
        timestamp: now
      };
      console.log("✓ Data cached for", cacheKey);
      return data;
    } catch (error) {
      console.error("Fetch error:", error);
      throw error;
    }
  }
  async function extractDependencies(files, owner, repo) {
    const deps = { npm: [], python: [], flutter: [], rust: [], go: [], maven: [], gradle: [] };
    const packageJson = files.find((f) => f.path === "package.json");
    if (packageJson) {
      try {
        const content = await fetchFileContent(owner, repo, "package.json");
        const pkg = JSON.parse(content);
        if (pkg.dependencies) {
          deps.npm = Object.entries(pkg.dependencies).map(([name, version]) => ({
            name,
            version,
            outdated: isVersionOutdated(version)
          }));
        }
      } catch (e) {
      }
    }
    const requirementsTxt = files.find((f) => f.path === "requirements.txt");
    if (requirementsTxt) {
      try {
        const content = await fetchFileContent(owner, repo, "requirements.txt");
        deps.python = content.split("\n").filter((line) => line.trim() && !line.startsWith("#")).map((line) => {
          const [name, version] = line.split("==");
          return {
            name: name.trim(),
            version: version || "latest",
            outdated: false
          };
        });
      } catch (e) {
      }
    }
    const pubspecYaml = files.find((f) => f.path === "pubspec.yaml");
    if (pubspecYaml) {
      try {
        const content = await fetchFileContent(owner, repo, "pubspec.yaml");
        const lines = content.split("\n");
        let inDeps = false;
        lines.forEach((line) => {
          if (line.trim() === "dependencies:") inDeps = true;
          else if (line.trim() === "dev_dependencies:") inDeps = false;
          else if (inDeps && line.includes(":")) {
            const match = line.match(/(\w+):\s*(.+)/);
            if (match) deps.flutter.push({
              name: match[1],
              version: match[2].trim(),
              outdated: false
            });
          }
        });
      } catch (e) {
      }
    }
    const cargoToml = files.find((f) => f.path === "Cargo.toml");
    if (cargoToml) {
      try {
        const content = await fetchFileContent(owner, repo, "Cargo.toml");
        const lines = content.split("\n");
        let inDeps = false;
        lines.forEach((line) => {
          if (line.trim() === "[dependencies]") inDeps = true;
          else if (line.trim().startsWith("[") && line.trim() !== "[dependencies]") inDeps = false;
          else if (inDeps && line.includes("=")) {
            const match = line.match(/(\S+)\s*=\s*"(.+)"/);
            if (match) deps.rust.push({
              name: match[1],
              version: match[2],
              outdated: false
            });
          }
        });
      } catch (e) {
      }
    }
    return deps;
  }
  function isVersionOutdated(version) {
    return version.includes("^") || version.includes("~");
  }
  function detectTechStack(files, info) {
    const stack = {
      frontend: [],
      backend: [],
      database: [],
      devops: [],
      testing: [],
      mobile: []
    };
    const fileNames = files.map((f) => f.path.toLowerCase());
    const allContent = fileNames.join(" ");
    if (fileNames.some((f) => f === "package.json")) {
      stack.backend.push({ name: "Node.js" });
    }
    if (allContent.includes("react")) {
      stack.frontend.push({ name: "React" });
    }
    if (allContent.includes("vue")) {
      stack.frontend.push({ name: "Vue.js" });
    }
    if (allContent.includes("angular")) {
      stack.frontend.push({ name: "Angular" });
    }
    if (allContent.includes("express")) {
      stack.backend.push({ name: "Express" });
    }
    if (allContent.includes("django") || fileNames.some((f) => f.includes("django"))) {
      stack.backend.push({ name: "Django" });
    }
    if (allContent.includes("flask")) {
      stack.backend.push({ name: "Flask" });
    }
    if (fileNames.some((f) => f === "pubspec.yaml")) {
      stack.mobile.push({ name: "Flutter" });
    }
    if (fileNames.some((f) => f === "cargo.toml")) {
      stack.backend.push({ name: "Rust" });
    }
    if (fileNames.some((f) => f === "go.mod")) {
      stack.backend.push({ name: "Go" });
    }
    if (allContent.includes("mongodb") || allContent.includes("mongoose")) {
      stack.database.push({ name: "MongoDB" });
    }
    if (allContent.includes("postgresql") || allContent.includes("postgres")) {
      stack.database.push({ name: "PostgreSQL" });
    }
    if (allContent.includes("mysql")) {
      stack.database.push({ name: "MySQL" });
    }
    if (allContent.includes("redis")) {
      stack.database.push({ name: "Redis" });
    }
    if (fileNames.some((f) => f === "dockerfile" || f.includes("docker-compose"))) {
      stack.devops.push({ name: "Docker" });
    }
    if (fileNames.some((f) => f.includes(".github/workflows"))) {
      stack.devops.push({ name: "GitHub Actions" });
    }
    if (fileNames.some((f) => f === ".circleci/config.yml")) {
      stack.devops.push({ name: "CircleCI" });
    }
    if (allContent.includes("jest") || fileNames.some((f) => f.includes("jest.config"))) {
      stack.testing.push({ name: "Jest" });
    }
    if (allContent.includes("pytest") || fileNames.some((f) => f.includes("pytest"))) {
      stack.testing.push({ name: "Pytest" });
    }
    if (allContent.includes("webpack")) {
      stack.devops.push({ name: "Webpack" });
    }
    if (allContent.includes("vite")) {
      stack.devops.push({ name: "Vite" });
    }
    if (fileNames.some((f) => f.includes("build.gradle") || f.includes("pom.xml"))) {
      stack.backend.push({ name: "Java" });
    }
    if (fileNames.some((f) => f.includes("spring"))) {
      stack.backend.push({ name: "Spring Boot" });
    }
    return stack;
  }
  function calculateCodeMetrics(files, commits) {
    const totalLines = files.reduce((sum, f) => sum + (f.size || 0), 0) / 50;
    const commitsByMonth = {};
    commits.forEach((commit) => {
      const month = new Date(commit.commit.author.date).toLocaleDateString("en-US", { year: "numeric", month: "short" });
      commitsByMonth[month] = (commitsByMonth[month] || 0) + 1;
    });
    const avgCommitsPerMonth = commits.length > 0 ? Math.round(commits.length / Object.keys(commitsByMonth).length) : 0;
    const codeFiles = files.filter(
      (f) => f.path.match(/\.(js|jsx|ts|tsx|py|dart|rs|go|java|cpp|c)$/i)
    );
    const avgFileSize = codeFiles.length > 0 ? Math.round(codeFiles.reduce((sum, f) => sum + (f.size || 0), 0) / codeFiles.length) : 0;
    return {
      estimatedLines: Math.round(totalLines),
      codeFiles: codeFiles.length,
      avgFileSize,
      commitsByMonth,
      avgCommitsPerMonth,
      complexity: calculateComplexityScore(files)
    };
  }
  function calculateComplexityScore(files) {
    let score = 0;
    const deepNesting = files.filter((f) => f.path.split("/").length > 5).length;
    const largeFiles = files.filter((f) => f.size > 1e5).length;
    if (deepNesting > 50) score += 30;
    else if (deepNesting > 20) score += 15;
    if (largeFiles > 10) score += 30;
    else if (largeFiles > 5) score += 15;
    if (files.length > 1e3) score += 20;
    else if (files.length > 500) score += 10;
    return Math.min(100, score);
  }
  function analyzeSecurityIssues(files, info) {
    const issues = [];
    const hasGitignore = files.some((f) => f.path === ".gitignore");
    if (!hasGitignore) {
      issues.push({
        severity: "medium",
        title: "Missing .gitignore",
        description: "No .gitignore file found. Sensitive files might be committed."
      });
    }
    const hasEnvFile = files.some((f) => f.path === ".env" || f.path === ".env.local");
    if (hasEnvFile) {
      issues.push({
        severity: "high",
        title: "Environment file in repository",
        description: ".env file detected. This may contain sensitive credentials."
      });
    }
    const hasLockFile = files.some(
      (f) => f.path === "package-lock.json" || f.path === "yarn.lock" || f.path === "Cargo.lock" || f.path === "Pipfile.lock"
    );
    if (!hasLockFile && files.some((f) => f.path === "package.json")) {
      issues.push({
        severity: "low",
        title: "No lock file found",
        description: "Consider using a lock file for reproducible builds."
      });
    }
    const suspiciousFiles = files.filter(
      (f) => f.path.toLowerCase().includes("password") || f.path.toLowerCase().includes("secret") || f.path.toLowerCase().includes("api_key") || f.path.toLowerCase().includes("credentials")
    );
    if (suspiciousFiles.length > 0) {
      issues.push({
        severity: "high",
        title: "Suspicious files detected",
        description: `Found ${suspiciousFiles.length} file(s) with potentially sensitive names.`,
        files: suspiciousFiles.map((f) => f.path)
      });
    }
    return issues;
  }
  async function fetchFileContent(owner, repo, path) {
    const headers = await getAuthHeaders();
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, { headers });
    if (!response.ok) throw new Error("Failed to fetch file");
    const data = await response.json();
    return atob(data.content);
  }
  function findKeyFiles(fileTree) {
    const keyPatterns = {
      "package.json": "Node.js Config",
      "pubspec.yaml": "Flutter Config",
      "requirements.txt": "Python Config",
      "cargo.toml": "Rust Config",
      "go.mod": "Go Config",
      "pom.xml": "Maven Config",
      "build.gradle": "Gradle Config",
      "index.js": "Entry Point",
      "main.py": "Entry Point",
      "app.py": "Entry Point",
      "main.dart": "Entry Point",
      "main.go": "Entry Point",
      "main.rs": "Entry Point",
      "index.html": "Frontend Entry",
      "dockerfile": "Docker Config",
      ".gitignore": "Git Config",
      "license": "License",
      "makefile": "Build Config"
    };
    const found = [];
    fileTree.forEach((item) => {
      if (item.type !== "blob") return;
      const fileName = item.path.split("/").pop().toLowerCase();
      if (keyPatterns[fileName]) {
        found.push({
          path: item.path,
          name: fileName,
          type: keyPatterns[fileName]
        });
      }
    });
    return found;
  }
  function categorizeFiles(files) {
    const categories = {
      frontend: [],
      backend: [],
      config: [],
      tests: [],
      docs: []
    };
    files.forEach((file) => {
      const path = file.path.toLowerCase();
      if (path.match(/\/(lib|src|components?|views?|pages?|widgets?|ui)\//i) || path.match(/\.(dart|jsx?|tsx?|vue|svelte|css|scss|sass|less)$/i)) {
        categories.frontend.push(file);
      } else if (path.match(/\/(server|api|routes?|controllers?|models?|services?)\//i) || path.match(/\.(py|java|go|rs|php|rb)$/i)) {
        categories.backend.push(file);
      } else if (path.match(/\.(json|ya?ml|toml|lock|config|ini)$/i) || path.match(/^(package|pubspec|cargo|go\.mod|gemfile|dockerfile|makefile)/i)) {
        categories.config.push(file);
      } else if (path.match(/\/(test|__tests__|spec|e2e)\//i) || path.match(/\.(test|spec)\./i) || path.match(/_test\./i)) {
        categories.tests.push(file);
      } else if (path.match(/\.(md|txt|rst|adoc)$/i) || path.match(/^(readme|contributing|changelog|license|authors)/i)) {
        categories.docs.push(file);
      }
    });
    return categories;
  }
  function buildFileTree(items) {
    const root = { name: "", type: "folder", children: {}, files: [], path: "" };
    items.forEach((item) => {
      const parts = item.path.split("/");
      let current = root;
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        if (isLast && item.type === "blob") {
          current.files.push({
            name: part,
            path: item.path,
            size: item.size,
            type: "file"
          });
        } else {
          if (!current.children[part]) {
            current.children[part] = {
              name: part,
              type: "folder",
              children: {},
              files: [],
              path: parts.slice(0, index + 1).join("/")
            };
          }
          current = current.children[part];
        }
      });
    });
    return root;
  }
  function renderFileTree(node, owner, repo, level = 0) {
    let html = "";
    const folders = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
    folders.forEach((folder) => {
      const hasContent = Object.keys(folder.children).length > 0 || folder.files.length > 0;
      html += `
          <div class="tree-item" style="padding-left: ${level * 20 + 8}px;">
            <span class="tree-toggle">${hasContent ? "▶" : " "}</span>
            <span class="tree-icon">DIR</span>
            <span class="tree-name">${folder.name}</span>
            <span style="color: #8b949e; font-size: 11px; margin-left: auto;">${Object.keys(folder.children).length + folder.files.length}</span>
          </div>
          <div class="tree-children">
            ${renderFileTree(folder, owner, repo, level + 1)}
          </div>
        `;
    });
    const files = node.files.sort((a, b) => a.name.localeCompare(b.name));
    files.forEach((file) => {
      html += `
          <div class="tree-item" style="padding-left: ${level * 20 + 8}px;" data-path="${file.path}">
            <span class="tree-toggle"></span>
            <span class="tree-icon">FILE</span>
            <span class="tree-name file">${file.name}</span>
            ${file.size ? `<span style="color: #8b949e; font-size: 11px; margin-left: auto;">${formatBytes(file.size)}</span>` : ""}
          </div>
        `;
    });
    return html;
  }
  function calculateStats(files, folders, info) {
    const extensions = {};
    let totalSize = 0;
    let largestFile = null;
    const largFiles = [];
    files.forEach((file) => {
      const ext = file.path.split(".").pop().toLowerCase();
      if (ext && ext !== file.path) {
        extensions[ext] = (extensions[ext] || 0) + 1;
      }
      totalSize += file.size || 0;
      if (file.size > 1e5) largFiles.push(file);
      if (!largestFile || file.size && file.size > (largestFile.size || 0)) {
        largestFile = file;
      }
    });
    const topExtensions = Object.entries(extensions).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const healthScore = calculateHealthScore(files, folders, largFiles);
    return {
      totalFiles: files.length,
      totalFolders: folders.length,
      totalSize,
      largestFile,
      largFiles: largFiles.sort((a, b) => b.size - a.size).slice(0, 10),
      topExtensions,
      language: info.language,
      stars: info.stargazers_count || 0,
      forks: info.forks_count || 0,
      openIssues: info.open_issues_count || 0,
      healthScore
    };
  }
  function calculateHealthScore(files, folders, largFiles) {
    let score = 100;
    if (largFiles.length > 10) score -= 20;
    else if (largFiles.length > 5) score -= 10;
    const hasTests = files.some((f) => f.path.includes("test"));
    if (!hasTests) score -= 15;
    const hasReadme = files.some((f) => f.path.toLowerCase() === "readme.md");
    if (!hasReadme) score -= 10;
    const hasLicense = files.some((f) => f.path.toLowerCase().includes("license"));
    if (!hasLicense) score -= 5;
    if (files.length > 1e3) score -= 10;
    return Math.max(0, Math.min(100, score));
  }
  function generateOnboardingSteps(data) {
    const steps = [];
    const configs = data.keyFiles.filter((f) => f.type.includes("Config"));
    if (configs.length > 0) {
      const config = configs[0];
      let command = "Check configuration file";
      if (config.name === "package.json") command = "npm install";
      else if (config.name === "pubspec.yaml") command = "flutter pub get";
      else if (config.name === "requirements.txt") command = "pip install -r requirements.txt";
      else if (config.name === "cargo.toml") command = "cargo build";
      else if (config.name === "go.mod") command = "go mod download";
      steps.push({ title: "Install Dependencies", file: config.path, command });
    }
    const entry = data.keyFiles.find((f) => f.type === "Entry Point");
    if (entry) {
      steps.push({ title: "Explore Entry Point", file: entry.path });
    }
    if (data.categorized.frontend.length > 0) {
      const mainFolder = data.categorized.frontend[0].path.split("/")[0];
      steps.push({ title: "Explore Main Code", file: mainFolder + "/" });
    } else if (data.categorized.backend.length > 0) {
      const mainFolder = data.categorized.backend[0].path.split("/")[0];
      steps.push({ title: "Explore Main Code", file: mainFolder + "/" });
    }
    return steps.length > 0 ? steps : [{ title: "Browse Repository", file: "Explore the files in the tree tab" }];
  }
  async function updateRateLimitDisplay() {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${GITHUB_API}/rate_limit`, { headers });
      const data = await response.json();
      const display = document.getElementById("rate-limit-status");
      if (display) {
        const remaining = data.rate.remaining;
        const limit = data.rate.limit;
        const resetTime = new Date(data.rate.reset * 1e3).toLocaleTimeString();
        if (remaining < CONFIG.API_RATE_LIMIT_WARNING) {
          display.style.color = "#da3633";
          display.textContent = `${remaining}/${limit} API requests left (resets at ${resetTime})`;
        } else {
          display.style.color = "#8b949e";
          display.textContent = `${remaining}/${limit} API requests remaining`;
        }
      }
    } catch (e) {
      console.warn("Could not update rate limit display");
    }
  }
  function renderSidebar(sidebar, owner, repo, data) {
    const mainContent = sidebar.querySelector("#sidebar-main-content");
    const steps = generateOnboardingSteps(data);
    mainContent.innerHTML = `
            ${renderOverviewTab(data, steps)}
            ${renderTreeTab()}
            ${renderSearchTab()}
            ${renderInsightsTab(data)}
            ${renderMetricsTab(data)}
            ${renderContributorsTab(data)}
            ${renderDependenciesTab(data)}
            ${renderSecurityTab(data)}
            ${renderTechStackTab(data)}
            ${renderVisualizeTab()}
            ${renderToolsTab(owner, repo)}
            ${renderAboutTab()}
        `;
    setupTabSwitching(sidebar);
    setupEventHandlers(mainContent, owner, repo, data);
    updateRateLimitDisplay();
    if (rateLimitInterval) {
      clearInterval(rateLimitInterval);
    }
    rateLimitInterval = setInterval(updateRateLimitDisplay, 6e4);
  }
  function setupEventHandlers(container, owner, repo, data) {
    const treeContainer = container.querySelector("#file-tree-container");
    if (treeContainer) {
      treeContainer.innerHTML = renderFileTree(data.fileTree, owner, repo);
    }
    setupFileClickHandlers(container, owner, repo);
    setupTreeToggleHandlers(container);
    setupSearchFunctionality(container, data, owner, repo);
    setupCloneTools(container, owner, repo);
    setupExportTools(container, data, owner, repo);
    setupKeyFilesToggle(container);
    setupVisualizationToggle(container, data, owner, repo);
  }
  function renderOverviewTab(data, steps) {
    return `
            <div class="tab-content active" id="tab-overview">
                ${renderOnboardingSteps(steps)}
                ${renderRepoStats(data.stats)}
                ${data.info.description ? renderDescription(data.info.description) : ""}
                ${renderKeyFiles(data.keyFiles)}
                ${renderFileCategories(data.categorized, data.stats.totalFiles)}
            </div>
        `;
  }
  function renderOnboardingSteps(steps) {
    return `
            <div class="section">
                <h3 class="section-title">Start Here</h3>
                <ol class="onboarding-steps">
                    ${steps.map((step) => `
                        <li class="onboarding-step">
                            <div class="step-title">${step.title}</div>
                            ${step.file ? `<div class="step-file">${step.file}</div>` : ""}
                            ${step.command ? `<div class="step-command">${step.command}</div>` : ""}
                        </li>
                    `).join("")}
                </ol>
            </div>
        `;
  }
  function renderRepoStats(stats) {
    const statItems = [
      { label: "Language", value: stats.language || "Unknown" },
      { label: "Stars", value: stats.stars.toLocaleString() },
      { label: "Forks", value: stats.forks.toLocaleString() },
      { label: "Open Issues", value: stats.openIssues.toLocaleString() },
      { label: "Total Files", value: stats.totalFiles.toLocaleString() },
      { label: "Repository Size", value: formatBytes(stats.totalSize) }
    ];
    return `
            <div class="section">
                <h3 class="section-title">Repository Stats</h3>
                <div class="stat-box">
                    ${statItems.map((item) => `
                        <div class="stat-row">
                            <span class="stat-label">${item.label}</span>
                            <span class="stat-value">${item.value}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
  }
  function renderDescription(description) {
    return `
            <div class="section">
                <h3 class="section-title">Description</h3>
                <p style="color: #8b949e; font-size: 13px; line-height: 1.6;">${description}</p>
            </div>
        `;
  }
  function renderKeyFiles(keyFiles) {
    if (keyFiles.length === 0) {
      return `
                <div class="section">
                    <h3 class="section-title">Key Files</h3>
                    <div style="color: #8b949e; font-size: 13px;">No key files detected</div>
                </div>
            `;
    }
    const visibleFiles = keyFiles.slice(0, CONFIG.MAX_KEY_FILES_PREVIEW);
    const hiddenFiles = keyFiles.slice(CONFIG.MAX_KEY_FILES_PREVIEW);
    return `
            <div class="section">
                <h3 class="section-title">Key Files</h3>
                <div id="key-files-list">
                    ${visibleFiles.map((file) => renderFileItem(file)).join("")}
                    
                    ${hiddenFiles.length > 0 ? `
                        <div id="key-files-hidden" style="display: none;">
                            ${hiddenFiles.map((file) => renderFileItem(file)).join("")}
                        </div>
                        <button class="btn-secondary" id="toggle-key-files" style="width: 100%; margin-top: 8px;">
                            Show More (${hiddenFiles.length} more)
                        </button>
                    ` : ""}
                </div>
            </div>
        `;
  }
  function renderFileItem(file) {
    return `
            <div class="file-item" data-path="${file.path}">
                <div class="file-name">${file.name}</div>
                <div class="file-path">${file.path}</div>
                <span class="file-type-badge">${file.type}</span>
            </div>
        `;
  }
  function renderFileCategories(categorized, totalFiles) {
    return `
            <div class="section">
                <h3 class="section-title">File Categories</h3>
                ${Object.entries(categorized).map(([cat, files]) => {
      if (files.length === 0) return "";
      const percentage = (files.length / totalFiles * 100).toFixed(1);
      return `
                        <div style="margin-bottom: 12px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span style="color: #c9d1d9; font-size: 13px; font-weight: 500;">
                                    ${cat.charAt(0).toUpperCase() + cat.slice(1)}
                                </span>
                                <span style="color: #8b949e; font-size: 12px;">${files.length} files</span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${percentage}%"></div>
                            </div>
                        </div>
                    `;
    }).join("")}
            </div>
        `;
  }
  function renderTreeTab() {
    return `
            <div class="tab-content" id="tab-tree">
                <div class="section">
                    <h3 class="section-title">File Tree Explorer</h3>
                    <div id="file-tree-container"></div>
                </div>
            </div>
        `;
  }
  function renderSearchTab() {
    return `
            <div class="tab-content" id="tab-search">
                <div class="section">
                    <h3 class="section-title">Search Files</h3>
                    <input type="text" class="search-input" id="file-search" placeholder="Type to search files...">
                    <div id="search-results" style="margin-top: 16px;"></div>
                </div>
            </div>
        `;
  }
  function renderInsightsTab(data) {
    const healthClass = getHealthClass(data.stats.healthScore);
    const healthMessage = getHealthMessage(data.stats.healthScore);
    return `
            <div class="tab-content" id="tab-insights">
                <div class="section">
                    <h3 class="section-title">Repository Health Score</h3>
                    <div class="health-score ${healthClass}">${data.stats.healthScore}/100</div>
                    <div style="text-align: center; color: #8b949e; font-size: 13px; margin-bottom: 20px;">
                        ${healthMessage}
                    </div>
                </div>
    
                ${renderQuickInsights(data)}
                ${renderFileTypeDistribution(data.stats)}
                ${renderLargeFiles(data.stats.largFiles)}
                ${renderRecentCommits(data.commits)}
            </div>
        `;
  }
  function getHealthClass(score) {
    if (score >= 80) return "health-excellent";
    if (score >= 60) return "health-good";
    if (score >= 40) return "health-fair";
    return "health-poor";
  }
  function getHealthMessage(score) {
    if (score >= 80) return "Excellent repository health!";
    if (score >= 60) return "Good repository health";
    if (score >= 40) return "Fair repository health";
    return "Needs improvement";
  }
  function renderQuickInsights(data) {
    const insights = [
      { value: data.stats.totalFiles.toLocaleString(), label: "Total Files" },
      { value: data.stats.topExtensions.length, label: "File Types" },
      { value: data.commits.length, label: "Recent Commits" },
      { value: data.contributors.length, label: "Contributors" }
    ];
    return `
            <div class="section">
                <h3 class="section-title">Quick Insights</h3>
                <div class="metric-grid">
                    ${insights.map((insight) => `
                        <div class="insight-card">
                            <div class="insight-value">${insight.value}</div>
                            <div class="insight-label">${insight.label}</div>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
  }
  function renderFileTypeDistribution(stats) {
    return `
            <div class="section">
                <h3 class="section-title">File Type Distribution</h3>
                ${stats.topExtensions.map(([ext, count]) => {
      const percentage = (count / stats.totalFiles * 100).toFixed(1);
      return `
                        <div style="margin-bottom: 14px;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span style="color: #c9d1d9; font-size: 13px; font-weight: 500;">.${ext}</span>
                                <span style="color: #8b949e; font-size: 12px;">${count} files (${percentage}%)</span>
                            </div>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${percentage}%"></div>
                            </div>
                        </div>
                    `;
    }).join("")}
            </div>
        `;
  }
  function renderLargeFiles(largFiles) {
    if (!largFiles || largFiles.length === 0) return "";
    return `
            <div class="section">
                <h3 class="section-title">Large Files (>100KB)</h3>
                ${largFiles.slice(0, 5).map((file) => `
                    <div class="file-item" data-path="${file.path}">
                        <div class="file-name">${file.path.split("/").pop()}</div>
                        <div class="file-path">${file.path}</div>
                        <span class="file-type-badge">${formatBytes(file.size)}</span>
                    </div>
                `).join("")}
            </div>
        `;
  }
  function renderRecentCommits(commits) {
    if (!commits || commits.length === 0) return "";
    return `
            <div class="section">
                <h3 class="section-title">Recent Commits</h3>
                ${commits.slice(0, 5).map((commit) => `
                    <div class="commit-item">
                        <div class="commit-message">${commit.commit.message.split("\n")[0]}</div>
                        <div class="commit-meta">
                            ${commit.commit.author.name} - ${new Date(commit.commit.author.date).toLocaleDateString()}
                        </div>
                    </div>
                `).join("")}
            </div>
        `;
  }
  function renderMetricsTab(data) {
    return `
            <div class="tab-content" id="tab-metrics">
                ${renderCodeMetricsCards(data.metrics)}
                ${renderComplexityScore(data.metrics)}
                ${renderCommitActivity(data.metrics)}
            </div>
        `;
  }
  function renderCodeMetricsCards(metrics) {
    const metricItems = [
      { value: metrics.estimatedLines.toLocaleString(), label: "Est. Lines of Code" },
      { value: metrics.codeFiles, label: "Code Files" },
      { value: formatBytes(metrics.avgFileSize), label: "Avg File Size" },
      { value: metrics.avgCommitsPerMonth, label: "Commits/Month" }
    ];
    return `
            <div class="section">
                <h3 class="section-title">Code Metrics</h3>
                <div class="metric-grid">
                    ${metricItems.map((item) => `
                        <div class="insight-card">
                            <div class="insight-value">${item.value}</div>
                            <div class="insight-label">${item.label}</div>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
  }
  function renderComplexityScore(metrics) {
    const complexityColor = metrics.complexity < 30 ? "#3fb950" : metrics.complexity < 60 ? "#d29922" : "#da3633";
    const complexityMessage = metrics.complexity < 30 ? "Low complexity - easy to maintain" : metrics.complexity < 60 ? "Moderate complexity" : "High complexity - may need refactoring";
    return `
            <div class="section">
                <h3 class="section-title">Complexity Score</h3>
                <div class="chart-container">
                    <div style="display: flex; align-items: center; justify-content: center; padding: 20px;">
                        <div style="position: relative; width: 120px; height: 120px;">
                            <svg viewBox="0 0 36 36" style="transform: rotate(-90deg);">
                                <circle cx="18" cy="18" r="16" fill="none" stroke="#21262d" stroke-width="3"></circle>
                                <circle cx="18" cy="18" r="16" fill="none" stroke="${complexityColor}" 
                                    stroke-width="3" stroke-dasharray="${metrics.complexity}, 100" stroke-linecap="round"></circle>
                            </svg>
                            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center;">
                                <div style="font-size: 24px; font-weight: 700; color: #c9d1d9;">${metrics.complexity}</div>
                                <div style="font-size: 11px; color: #8b949e;">Complexity</div>
                            </div>
                        </div>
                    </div>
                    <div style="text-align: center; color: #8b949e; font-size: 12px; padding: 0 12px 12px;">
                        ${complexityMessage}
                    </div>
                </div>
            </div>
        `;
  }
  function renderCommitActivity(metrics) {
    const maxCommits = Math.max(...Object.values(metrics.commitsByMonth));
    return `
            <div class="section">
                <h3 class="section-title">Commit Activity</h3>
                <div class="chart-container">
                    <div class="bar-chart">
                        ${Object.entries(metrics.commitsByMonth).slice(-6).map(([month, count]) => `
                            <div class="bar-item">
                                <div class="bar-label">${month}</div>
                                <div class="bar-fill-container">
                                    <div class="bar-fill" style="width: ${count / maxCommits * 100}%"></div>
                                </div>
                                <div class="bar-value">${count}</div>
                            </div>
                        `).join("")}
                    </div>
                </div>
            </div>
        `;
  }
  function renderContributorsTab(data) {
    return `
            <div class="tab-content" id="tab-contributors">
                <div class="section">
                    <h3 class="section-title">Top Contributors</h3>
                    ${data.contributors.length > 0 ? data.contributors.slice(0, 10).map((contributor) => `
                            <div class="contributor-item">
                                <img src="${contributor.avatar_url}" alt="${contributor.login}" class="contributor-avatar">
                                <div class="contributor-info">
                                    <div class="contributor-name">${contributor.login}</div>
                                    <div class="contributor-commits">${contributor.contributions} contributions</div>
                                </div>
                            </div>
                        `).join("") : '<div style="color: #8b949e; font-size: 13px; text-align: center; padding: 20px;">No contributor data available</div>'}
                </div>
            </div>
        `;
  }
  function renderDependenciesTab(data) {
    const hasDeps = Object.values(data.dependencies).some((arr) => arr.length > 0);
    return `
            <div class="tab-content" id="tab-dependencies">
                <div class="section">
                    <h3 class="section-title">Project Dependencies</h3>
                    ${renderDependencySection("NPM Packages", data.dependencies.npm)}
                    ${renderDependencySection("Python Packages", data.dependencies.python)}
                    ${renderDependencySection("Flutter Packages", data.dependencies.flutter)}
                    ${renderDependencySection("Rust Crates", data.dependencies.rust)}
                    
                    ${!hasDeps ? `
                        <div style="color: #8b949e; font-size: 13px; text-align: center; padding: 20px;">
                            No dependencies detected
                        </div>
                    ` : ""}
                </div>
            </div>
        `;
  }
  function renderDependencySection(title, dependencies) {
    if (!dependencies || dependencies.length === 0) return "";
    return `
            <div style="margin-bottom: 20px;">
                <h4 style="color: #c9d1d9; font-size: 13px; font-weight: 600; margin-bottom: 10px;">
                    ${title} (${dependencies.length})
                </h4>
                <div class="dependency-list">
                    ${dependencies.map((dep) => `
                        <div class="dependency-item">
                            <span class="dep-name">${dep.name}</span>
                            <span class="dep-version">${dep.version}</span>
                            ${dep.outdated ? '<span style="color: #d29922; font-size: 11px; margin-left: 8px;">Check version</span>' : ""}
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
  }
  function renderSecurityTab(data) {
    return `
            <div class="tab-content" id="tab-security">
                <div class="section">
                    <h3 class="section-title">Security Analysis</h3>
                    ${data.security.length > 0 ? data.security.map((issue) => `
                            <div class="security-alert ${issue.severity}">
                                <div class="security-alert-title">
                                    ${issue.severity.toUpperCase()} - ${issue.title}
                                </div>
                                <div class="security-alert-desc">${issue.description}</div>
                                ${issue.files ? `
                                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #30363d;">
                                        ${issue.files.map((file) => `
                                            <div style="color: #8b949e; font-size: 11px; font-family: monospace; margin-top: 4px;">
                                                ${file}
                                            </div>
                                        `).join("")}
                                    </div>
                                ` : ""}
                            </div>
                        `).join("") : `
                            <div style="background: rgba(63, 185, 80, 0.1); border: 1px solid #3fb950; border-radius: 6px; padding: 12px; text-align: center; color: #3fb950;">
                                No security issues detected
                            </div>
                        `}
                </div>
                ${renderSecurityChecklist(data.files)}
            </div>
        `;
  }
  function renderSecurityChecklist(files) {
    const checks = [
      { label: ".gitignore file present", passed: files.some((f) => f.path === ".gitignore") },
      { label: "License file present", passed: files.some((f) => f.path.toLowerCase().includes("license")) },
      { label: "No .env files in repo", passed: !files.some((f) => f.path === ".env" || f.path === ".env.local") },
      {
        label: "Lock file for dependencies",
        passed: files.some(
          (f) => f.path === "package-lock.json" || f.path === "yarn.lock" || f.path === "Cargo.lock"
        )
      }
    ];
    return `
            <div class="section">
                <h3 class="section-title">Security Checklist</h3>
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                    ${checks.map((check, index) => `
                        <div style="display: flex; align-items: center; padding: 8px 0; ${index < checks.length - 1 ? "border-bottom: 1px solid #30363d;" : ""}">
                            <span style="font-size: 16px; margin-right: 12px;">${check.passed ? "✓" : "✗"}</span>
                            <span style="color: #c9d1d9; font-size: 13px;">${check.label}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
  }
  function renderTechStackTab(data) {
    const hasStack = Object.values(data.techStack).some((arr) => arr.length > 0);
    return `
            <div class="tab-content" id="tab-tech">
                <div class="section">
                    <h3 class="section-title">Technology Stack</h3>
                    ${renderTechCategory("Frontend", data.techStack.frontend)}
                    ${renderTechCategory("Backend", data.techStack.backend)}
                    ${renderTechCategory("Database", data.techStack.database)}
                    ${renderTechCategory("DevOps & Build", data.techStack.devops)}
                    ${renderTechCategory("Mobile", data.techStack.mobile)}
                    ${renderTechCategory("Testing", data.techStack.testing)}
                    
                    ${!hasStack ? `
                        <div style="color: #8b949e; font-size: 13px; text-align: center; padding: 20px;">
                            Technology stack could not be detected automatically
                        </div>
                    ` : ""}
                </div>
            </div>
        `;
  }
  function renderTechCategory(title, technologies) {
    if (!technologies || technologies.length === 0) return "";
    return `
            <div style="margin-bottom: 20px;">
                <h4 style="color: #c9d1d9; font-size: 13px; font-weight: 600; margin-bottom: 10px;">${title}</h4>
                <div style="display: flex; flex-wrap: wrap;">
                    ${technologies.map((tech) => `
                        <div class="tech-badge">
                            <span>${tech.name}</span>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
  }
  function renderVisualizeTab() {
    return `
            <div class="tab-content" id="tab-visualize">
                <div class="section">
                    <h3 class="section-title">Interactive Repository Graph</h3>
                    <div id="viz-graph" style="position: relative; width: 100%; height: 600px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; overflow: hidden;">
                        <canvas width="468" height="600" style="display: block; width: 100%;"></canvas>
                        <div class="viz-tooltip" style="position: absolute; display: none; background: #161b22; border: 1px solid #30363d; padding: 8px 12px; border-radius: 4px; pointer-events: none; z-index: 1000; font-size: 11px; color: #c9d1d9;"></div>
                        <div style="position: absolute; top: 12px; right: 12px; background: rgba(22, 27, 34, 0.9); border: 1px solid #30363d; padding: 8px 12px; border-radius: 6px; font-size: 11px; color: #8b949e; line-height: 1.6;">
                            <div style="color: #c9d1d9; font-weight: 600; margin-bottom: 4px;">Controls:</div>
                            <div>Scroll to zoom</div>
                            <div>Drag nodes to move</div>
                            <div>Drag canvas to pan</div>
                            <div>Click folders to zoom</div>
                            <div>Click files to open</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }
  function renderToolsTab(owner, repo) {
    return `
            <div class="tab-content" id="tab-tools">
                ${renderCloneSection(owner, repo)}
                ${renderQuickCommands(owner, repo)}
                ${renderExportSection()}
            </div>
        `;
  }
  function renderAboutTab() {
    return `
            <div class="tab-content" id="tab-about">
                <div class="section">
                    <div style="text-align: center; padding: 20px 0;">
                        <img src="${chrome.runtime.getURL("icons/logo64light.png")}" 
                             alt="GitNav Logo" s
                             style="width: 64px; height: 64px; border-radius: 12px; margin-bottom: 12px;" />
                        <h2 style="font-size: 24px; font-weight: 700; color: #c9d1d9; margin: 0 0 8px 0;">GitNav</h2>
                        <div style="color: #8b949e; font-size: 13px; margin-bottom: 20px;">Version 1.0.0</div>
                    </div>

                    <div class="stat-box">
                        <div style="color: #c9d1d9; font-size: 14px; line-height: 1.8; text-align: center;">
                            Navigate GitHub repositories with powerful analytics, 
                            interactive visualizations, and smart insights.
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h3 class="section-title">Created By</h3>
                    <div class="stat-box">
                        <div style="text-align: center; padding: 12px;">
                            <div style="font-size: 18px; font-weight: 600; color: #58a6ff; margin-bottom: 4px;">
                                Varun Karamchandani
                            </div>
                            <div style="color: #8b949e; font-size: 13px; margin-bottom: 12px;">
                                Computer Science Student @ SUNY Binghamton University
                            </div>
                            <div style="display: flex; gap: 12px; justify-content: center; margin-top: 16px; flex-wrap: wrap;">
                                <a href="https://github.com/SELESTER11" target="_blank" 
                                   style="color: #58a6ff; text-decoration: none; font-size: 13px;">
                                   GitHub →
                                </a>
                                <a href="https://linkedin.com/in/varunkkc" target="_blank" 
                                   style="color: #58a6ff; text-decoration: none; font-size: 13px;">
                                   LinkedIn →
                                </a>
                                <a href="https://my-portfolio-v4-three.vercel.app/" target="_blank" 
                                   style="color: #58a6ff; text-decoration: none; font-size: 13px;">
                                   Portfolio →
                                </a>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h3 class="section-title">Features</h3>
                    <div style="color: #8b949e; font-size: 13px; line-height: 2;">
                        ✓ Interactive force-directed repository visualization<br>
                        ✓ File tree explorer with instant search<br>
                        ✓ Dependency analysis for multiple languages<br>
                        ✓ Code metrics and complexity scoring<br>
                        ✓ Security vulnerability detection<br>
                        ✓ Technology stack identification<br>
                        ✓ Repository health scoring<br>
                        ✓ Private repository support with GitHub tokens<br>
                        ✓ Export analysis as JSON or Markdown
                    </div>
                </div>

                <div class="section">
                    <h3 class="section-title">Privacy & Data</h3>
                    <div class="stat-box">
                        <div style="color: #8b949e; font-size: 12px; line-height: 1.6;">
                            <strong style="color: #c9d1d9;">Your privacy matters:</strong><br>
                            • All data stays local in your browser<br>
                            • GitHub tokens stored securely in Chrome storage<br>
                            • No analytics or tracking<br>
                            • No data sent to external servers<br>
                            • Open source - inspect the code yourself
                        </div>
                    </div>
                </div>

                <div class="section">
                    <h3 class="section-title">Support & Contribute</h3>
                    <div style="display: grid; gap: 10px;">
                        <button class="btn-primary" onclick="window.open('https://github.com/SELESTER11/GitNav', '_blank')">
                            Star on GitHub
                        </button>
                        <button class="btn-secondary" onclick="window.open('https://github.com/SELESTER11/GitNav/issues', '_blank')" 
                                style="width: 100%; margin: 0;">
                            Report an Issue
                        </button>
                    </div>
                </div>

                <div class="section">
                    <div style="text-align: center; color: #8b949e; font-size: 11px; padding: 20px 0;">
                        Made with ❤️ by Varun Karamchandani<br>
                        Licensed under MIT License
                    </div>
                </div>
            </div>
        `;
  }
  function renderCloneSection(owner, repo) {
    return `
            <div class="section">
                <h3 class="section-title">Clone Repository</h3>
                <div style="margin-bottom: 16px;">
                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <button class="btn-secondary" id="clone-https-btn">HTTPS</button>
                        <button class="btn-secondary" id="clone-ssh-btn">SSH</button>
                    </div>
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px 12px; font-family: monospace; font-size: 12px; display: flex; align-items: center; justify-content: space-between;">
                        <span id="clone-url">https://github.com/${owner}/${repo}.git</span>
                        <button class="copy-btn" id="copy-clone-btn">Copy</button>
                    </div>
                </div>
            </div>
        `;
  }
  function renderQuickCommands(owner, repo) {
    return `
            <div class="section">
                <h3 class="section-title">Quick Commands</h3>
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
                    <div style="color: #8b949e; font-size: 12px; margin-bottom: 6px;">Clone repository</div>
                    <div style="font-family: monospace; font-size: 12px; color: #c9d1d9; display: flex; justify-content: space-between; align-items: center;">
                        <span>git clone https://github.com/${owner}/${repo}.git</span>
                        <button class="copy-btn" onclick="copyToClipboard('git clone https://github.com/${owner}/${repo}.git')">Copy</button>
                    </div>
                </div>
                
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px; margin-bottom: 12px;">
                    <div style="color: #8b949e; font-size: 12px; margin-bottom: 6px;">View on GitHub</div>
                    <button class="btn-primary" onclick="window.open('https://github.com/${owner}/${repo}', '_blank')">
                        Open Repository
                    </button>
                </div>
                
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                    <div style="color: #8b949e; font-size: 12px; margin-bottom: 6px;">Repository URL</div>
                    <div style="font-family: monospace; font-size: 12px; color: #58a6ff; word-break: break-all;">
                        https://github.com/${owner}/${repo}
                    </div>
                </div>
            </div>
        `;
  }
  function renderExportSection() {
    return `
            <div class="section">
                <h3 class="section-title">Export Analysis</h3>
                <div class="export-options">
                    <button class="btn-secondary export-btn" id="export-json-btn">Export as JSON</button>
                    <button class="btn-secondary export-btn" id="export-md-btn">Export as Markdown</button>
                </div>
            </div>
        `;
  }
  function initForceGraphVisualization(containerId, files, owner, repo) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const canvas = container.querySelector("canvas");
    const tooltip = container.querySelector(".viz-tooltip");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const width = 468;
    const height = 600;
    const PHYSICS = {
      centerForce: 2e-3,
      collisionForce: 0.8,
      linkForce: 0.08,
      repulsionForce: 800,
      damping: 0.85,
      alpha: 0.5,
      minDistance: 5,
      coolingFactor: 0.995
    };
    let temperature = 1;
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragNode = null;
    let hoverNode = null;
    const nodes = [];
    const links = [];
    const folderMap = /* @__PURE__ */ new Map();
    const root = {
      id: "root",
      name: "Repository",
      x: width / 2,
      y: height / 2,
      vx: 0,
      vy: 0,
      r: 28,
      color: "#58a6ff",
      type: "root",
      fixed: false
    };
    nodes.push(root);
    folderMap.set("root", root);
    const validFiles = files.filter((f) => f.size > 0).slice(0, CONFIG.MAX_FILES_IN_GRAPH);
    const folderFiles = /* @__PURE__ */ new Map();
    validFiles.forEach((file) => {
      const parts = file.path.split("/");
      const firstFolder = parts.length > 1 ? parts[0] : "root";
      if (!folderFiles.has(firstFolder)) folderFiles.set(firstFolder, []);
      folderFiles.get(firstFolder).push(file);
    });
    const folderEntries = Array.from(folderFiles.entries()).filter(([name]) => name !== "root");
    const folderRadius = 180;
    folderEntries.forEach(([folderName, folderFilesList], index) => {
      const angle = index / folderEntries.length * Math.PI * 2;
      const folder = {
        id: folderName,
        name: folderName,
        x: width / 2 + Math.cos(angle) * folderRadius,
        y: height / 2 + Math.sin(angle) * folderRadius,
        vx: 0,
        vy: 0,
        r: 18 + Math.min(folderFilesList.length / 5, 8),
        color: "#238636",
        type: "folder",
        fileCount: folderFilesList.length,
        fixed: false
      };
      nodes.push(folder);
      folderMap.set(folderName, folder);
      links.push({
        source: root,
        target: folder,
        strength: 0.3
      });
    });
    validFiles.forEach((file) => {
      const parts = file.path.split("/");
      const fileName = parts.pop();
      const parentFolder = parts.length > 0 ? parts[0] : "root";
      const parent = folderMap.get(parentFolder);
      if (!parent) return;
      const angle = Math.random() * Math.PI * 2;
      const distance = 60 + Math.random() * 50;
      const fileNode = {
        id: file.path,
        name: fileName,
        x: parent.x + Math.cos(angle) * distance,
        y: parent.y + Math.sin(angle) * distance,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        r: Math.min(4 + Math.sqrt(file.size / 15e3), 10),
        color: getFileColor(file.path),
        type: "file",
        path: file.path,
        size: file.size,
        fixed: false
      };
      nodes.push(fileNode);
      links.push({
        source: parent,
        target: fileNode,
        strength: 0.5
      });
    });
    function getFileColor(path) {
      const ext = path.split(".").pop().toLowerCase();
      const colors = {
        "js": "#f1e05a",
        "jsx": "#61dafb",
        "ts": "#3178c6",
        "tsx": "#3178c6",
        "py": "#3572A5",
        "dart": "#00B4AB",
        "rs": "#dea584",
        "go": "#00ADD8",
        "java": "#b07219",
        "html": "#e34c26",
        "css": "#563d7c",
        "scss": "#c6538c",
        "json": "#292929",
        "md": "#083fa1",
        "yaml": "#cb171e",
        "yml": "#cb171e"
      };
      return colors[ext] || "#8b949e";
    }
    function simulate() {
      nodes.forEach((node, i) => {
        if (node.fixed || node === dragNode) return;
        const centerX = width / 2;
        const centerY = height / 2;
        node.vx += (centerX - node.x) * PHYSICS.centerForce;
        node.vy += (centerY - node.y) * PHYSICS.centerForce;
        nodes.forEach((other, j) => {
          if (i === j) return;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq);
          if (dist < PHYSICS.minDistance) return;
          const force = PHYSICS.repulsionForce / distSq;
          const fx = dx / dist * force;
          const fy = dy / dist * force;
          node.vx += fx;
          node.vy += fy;
        });
        nodes.forEach((other, j) => {
          if (i >= j) return;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = node.r + other.r + 10;
          if (dist < minDist && dist > 0) {
            const force = (minDist - dist) * PHYSICS.collisionForce;
            const fx = dx / dist * force;
            const fy = dy / dist * force;
            if (!node.fixed && node !== dragNode) {
              node.vx += fx * 0.5;
              node.vy += fy * 0.5;
            }
            if (!other.fixed && other !== dragNode) {
              other.vx -= fx * 0.5;
              other.vy -= fy * 0.5;
            }
          }
        });
      });
      links.forEach((link) => {
        const source = link.source;
        const target = link.target;
        if (source.fixed || target.fixed) return;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let targetDist = 80;
        if (source.type === "root") targetDist = 160;
        if (source.type === "folder" && target.type === "file") targetDist = 70;
        const force = (dist - targetDist) * PHYSICS.linkForce * link.strength;
        const fx = dx / dist * force;
        const fy = dy / dist * force;
        if (source !== dragNode) {
          source.vx += fx;
          source.vy += fy;
        }
        if (target !== dragNode) {
          target.vx -= fx;
          target.vy -= fy;
        }
      });
      nodes.forEach((node) => {
        if (node.fixed || node === dragNode) return;
        node.vx *= PHYSICS.damping;
        node.vy *= PHYSICS.damping;
        node.x += node.vx * PHYSICS.alpha * temperature;
        node.y += node.vy * PHYSICS.alpha * temperature;
        const margin = 50;
        if (node.x < margin) node.vx += 0.5;
        if (node.x > width - margin) node.vx -= 0.5;
        if (node.y < margin) node.vy += 0.5;
        if (node.y > height - margin) node.vy -= 0.5;
      });
      temperature *= PHYSICS.coolingFactor;
      temperature = Math.max(0.1, temperature);
    }
    let stableFrames = 0;
    function draw() {
      const vizTab = document.querySelector("#tab-visualize");
      if (!vizTab || !vizTab.classList.contains("active")) {
        setTimeout(() => requestAnimationFrame(draw), 500);
        return;
      }
      let maxVelocity = 0;
      nodes.forEach((node) => {
        const velocity = Math.abs(node.vx) + Math.abs(node.vy);
        if (velocity > maxVelocity) maxVelocity = velocity;
      });
      if (maxVelocity < 0.01 && temperature < 0.15) {
        stableFrames++;
        if (stableFrames > 60) {
          setTimeout(() => requestAnimationFrame(draw), 500);
          return;
        }
      } else {
        stableFrames = 0;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(translateX * scale, translateY * scale);
      ctx.scale(scale, scale);
      links.forEach((link) => {
        const source = link.source;
        const target = link.target;
        const gradient = ctx.createLinearGradient(source.x, source.y, target.x, target.y);
        gradient.addColorStop(0, source.color + "40");
        gradient.addColorStop(1, target.color + "40");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.5 / scale;
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      });
      nodes.forEach((node) => {
        if (node === hoverNode) {
          ctx.shadowBlur = 15;
          ctx.shadowColor = node.color;
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
        if (node === hoverNode) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 / scale;
          ctx.stroke();
        } else if (node.type === "root" || node.type === "folder") {
          ctx.strokeStyle = "#00000040";
          ctx.lineWidth = 1 / scale;
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        if (node.r > 10 || node === hoverNode || node.type !== "file") {
          ctx.fillStyle = "#ffffff";
          ctx.font = `${Math.max(9, node.r)}px -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const maxLength = node.type === "file" ? 12 : 18;
          const displayName = node.name.length > maxLength ? node.name.substring(0, maxLength - 1) + "…" : node.name;
          const textWidth = ctx.measureText(displayName).width;
          ctx.fillStyle = "rgba(13, 17, 23, 0.9)";
          ctx.fillRect(node.x - textWidth / 2 - 3, node.y + node.r + 3, textWidth + 6, 14);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(displayName, node.x, node.y + node.r + 5);
        }
      });
      simulate();
      requestAnimationFrame(draw);
    }
    function screenToWorld(x, y) {
      return {
        x: x / scale - translateX,
        y: y / scale - translateY
      };
    }
    canvas.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.5, Math.min(2.5, scale * delta));
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      translateX = mouseX / scale - mouseX / newScale + translateX;
      translateY = mouseY / scale - mouseY / newScale + translateY;
      scale = newScale;
    };
    canvas.onmousedown = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const world = screenToWorld(mx, my);
      dragNode = nodes.find((n) => Math.hypot(n.x - world.x, n.y - world.y) < n.r);
      if (!dragNode) {
        isDragging = true;
        dragStartX = mx;
        dragStartY = my;
      }
      temperature = 0.5;
      stableFrames = 0;
    };
    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const world = screenToWorld(mx, my);
      if (dragNode) {
        dragNode.x = world.x;
        dragNode.y = world.y;
        dragNode.vx = 0;
        dragNode.vy = 0;
        canvas.style.cursor = "grabbing";
      } else if (isDragging) {
        translateX += (mx - dragStartX) / scale;
        translateY += (my - dragStartY) / scale;
        dragStartX = mx;
        dragStartY = my;
        canvas.style.cursor = "grabbing";
      } else {
        hoverNode = nodes.find((n) => Math.hypot(n.x - world.x, n.y - world.y) < n.r);
        if (hoverNode) {
          tooltip.style.display = "block";
          tooltip.style.left = e.pageX + 10 + "px";
          tooltip.style.top = e.pageY - 30 + "px";
          let html = `<div style="font-weight: 600; margin-bottom: 4px;">${hoverNode.name}</div>`;
          if (hoverNode.type === "file") {
            html += `<div style="color: #8b949e; font-size: 10px;">${hoverNode.path}</div>`;
            html += `<div style="color: #58a6ff; margin-top: 4px;">${Math.round(hoverNode.size / 1024)} KB</div>`;
          } else if (hoverNode.type === "folder") {
            html += `<div style="color: #8b949e;">${hoverNode.fileCount} files</div>`;
          } else if (hoverNode.type === "root") {
            html += `<div style="color: #8b949e;">${nodes.length - 1} items</div>`;
          }
          tooltip.innerHTML = html;
          canvas.style.cursor = "pointer";
        } else {
          tooltip.style.display = "none";
          canvas.style.cursor = "grab";
        }
      }
    };
    canvas.onmouseup = () => {
      dragNode = null;
      isDragging = false;
      canvas.style.cursor = "grab";
    };
    canvas.onmouseleave = () => {
      dragNode = null;
      isDragging = false;
      tooltip.style.display = "none";
    };
    canvas.onclick = (e) => {
      if (hoverNode && hoverNode.type === "file") {
        window.open(`https://github.com/${owner}/${repo}/blob/main/${hoverNode.path}`, "_blank");
      } else if (hoverNode && (hoverNode.type === "folder" || hoverNode.type === "root")) {
        const targetScale = 1.5;
        scale = targetScale;
        translateX = width / 2 / scale - hoverNode.x;
        translateY = height / 2 / scale - hoverNode.y;
      }
    };
    draw();
  }
  function setupKeyFilesToggle(container) {
    const toggleBtn = container.querySelector("#toggle-key-files");
    const hiddenFiles = container.querySelector("#key-files-hidden");
    if (!toggleBtn || !hiddenFiles) return;
    let isExpanded = false;
    toggleBtn.addEventListener("click", () => {
      isExpanded = !isExpanded;
      if (isExpanded) {
        hiddenFiles.style.display = "block";
        toggleBtn.textContent = "Show Less";
      } else {
        hiddenFiles.style.display = "none";
        const hiddenCount = hiddenFiles.querySelectorAll(".file-item").length;
        toggleBtn.textContent = `Show More (${hiddenCount} more)`;
      }
    });
  }
  function setupTabSwitching(sidebar) {
    sidebar.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        sidebar.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
        sidebar.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const targetTab = sidebar.querySelector(`#tab-${tab.dataset.tab}`);
        if (targetTab) targetTab.classList.add("active");
      });
    });
  }
  function setupFileClickHandlers(container, owner, repo) {
    container.querySelectorAll("[data-path]").forEach((el) => {
      el.addEventListener("click", () => {
        const path = el.getAttribute("data-path");
        window.open(`https://github.com/${owner}/${repo}/blob/main/${path}`, "_blank");
      });
    });
  }
  function setupTreeToggleHandlers(container) {
    container.querySelectorAll(".tree-toggle").forEach((toggle) => {
      if (toggle.textContent.trim() === "") return;
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const treeItem = toggle.closest(".tree-item");
        const children = treeItem.nextElementSibling;
        if (children && children.classList.contains("tree-children")) {
          const isOpen = children.classList.toggle("open");
          toggle.textContent = isOpen ? "▼" : "▶";
        }
      });
    });
  }
  function setupSearchFunctionality(container, data, owner, repo) {
    const searchInput = container.querySelector("#file-search");
    const searchResults = container.querySelector("#search-results");
    if (!searchInput || !searchResults) return;
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase().trim();
      if (!query) {
        searchResults.innerHTML = "";
        return;
      }
      const matches = data.files.filter((f) => f.path.toLowerCase().includes(query)).slice(0, 30);
      if (matches.length === 0) {
        searchResults.innerHTML = '<div style="color: #8b949e; font-size: 13px; padding: 12px 0;">No files found matching your search</div>';
        return;
      }
      searchResults.innerHTML = `
          <div style="color: #8b949e; font-size: 12px; margin-bottom: 12px;">Found ${matches.length} file${matches.length !== 1 ? "s" : ""}</div>
          ${matches.map((file) => `
            <div class="file-item" onclick="window.open('https://github.com/${owner}/${repo}/blob/main/${file.path}', '_blank')">
              <div class="file-name">${file.path.split("/").pop()}</div>
              <div class="file-path">${file.path}</div>
            </div>
          `).join("")}
        `;
    });
  }
  function setupCloneTools(container, owner, repo) {
    const cloneUrl = container.querySelector("#clone-url");
    const copyCloneBtn = container.querySelector("#copy-clone-btn");
    const httpsBtn = container.querySelector("#clone-https-btn");
    const sshBtn = container.querySelector("#clone-ssh-btn");
    let isHttps = true;
    function updateCloneUrl() {
      if (isHttps) {
        cloneUrl.textContent = `https://github.com/${owner}/${repo}.git`;
      } else {
        cloneUrl.textContent = `git@github.com:${owner}/${repo}.git`;
      }
    }
    if (httpsBtn) {
      httpsBtn.addEventListener("click", () => {
        isHttps = true;
        updateCloneUrl();
        httpsBtn.style.background = "#30363d";
        sshBtn.style.background = "#21262d";
      });
    }
    if (sshBtn) {
      sshBtn.addEventListener("click", () => {
        isHttps = false;
        updateCloneUrl();
        sshBtn.style.background = "#30363d";
        httpsBtn.style.background = "#21262d";
      });
    }
    if (copyCloneBtn) {
      copyCloneBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(cloneUrl.textContent).then(() => {
          copyCloneBtn.textContent = "Copied!";
          copyCloneBtn.classList.add("copied");
          setTimeout(() => {
            copyCloneBtn.textContent = "Copy";
            copyCloneBtn.classList.remove("copied");
          }, 2e3);
        });
      });
    }
  }
  function setupExportTools(container, data, owner, repo) {
    const jsonBtn = container.querySelector("#export-json-btn");
    const mdBtn = container.querySelector("#export-md-btn");
    if (jsonBtn) {
      jsonBtn.addEventListener("click", () => {
        const exportData = {
          repository: `${owner}/${repo}`,
          analyzedAt: (/* @__PURE__ */ new Date()).toISOString(),
          stats: data.stats,
          metrics: data.metrics,
          dependencies: data.dependencies,
          security: data.security,
          techStack: data.techStack
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${repo}-analysis.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
    if (mdBtn) {
      mdBtn.addEventListener("click", () => {
        let markdown = `# ${owner}/${repo} - Repository Analysis

`;
        markdown += `Generated: ${(/* @__PURE__ */ new Date()).toLocaleString()}

`;
        markdown += `## Overview

`;
        markdown += `- **Language**: ${data.stats.language || "Unknown"}
`;
        markdown += `- **Stars**: ${data.stats.stars.toLocaleString()}
`;
        markdown += `- **Forks**: ${data.stats.forks.toLocaleString()}
`;
        markdown += `- **Total Files**: ${data.stats.totalFiles.toLocaleString()}
`;
        markdown += `- **Health Score**: ${data.stats.healthScore}/100

`;
        markdown += `## Code Metrics

`;
        markdown += `- **Estimated Lines**: ${data.metrics.estimatedLines.toLocaleString()}
`;
        markdown += `- **Code Files**: ${data.metrics.codeFiles}
`;
        markdown += `- **Complexity Score**: ${data.metrics.complexity}

`;
        if (data.security.length > 0) {
          markdown += `## Security Issues

`;
          data.security.forEach((issue) => {
            markdown += `- **[${issue.severity.toUpperCase()}]** ${issue.title}: ${issue.description}
`;
          });
          markdown += "\n";
        }
        const blob = new Blob([markdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${repo}-analysis.md`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }
  function setupVisualizationToggle(container, data, owner, repo) {
    const visualizeTab = document.querySelector('[data-tab="visualize"]');
    let graphInitialized = false;
    if (visualizeTab) {
      visualizeTab.addEventListener("click", () => {
        if (!graphInitialized) {
          setTimeout(() => {
            initForceGraphVisualization("viz-graph", data.files, owner, repo);
            graphInitialized = true;
          }, 100);
        }
      });
    }
  }
  window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
      const btn = event.target;
      const originalText = btn.textContent;
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove("copied");
      }, 2e3);
    });
  };
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  }
  function showError(sidebar, message) {
    const content = sidebar.querySelector("#sidebar-main-content");
    const tokenBanner = sidebar.querySelector("#token-setup-banner");
    if (message.includes("private") || message.includes("404") || message.includes("not found")) {
      if (tokenBanner) {
        tokenBanner.style.display = "block";
      }
    }
    let errorTitle = "Error Loading Repository";
    let errorMessage = message;
    let suggestions = [];
    if (message.includes("rate limit")) {
      errorTitle = "GitHub API Rate Limit Exceeded";
      suggestions = [
        "Wait for the rate limit to reset",
        "Add a GitHub personal access token (see console for instructions)",
        "Try a smaller repository"
      ];
    } else if (message.includes("not found")) {
      errorTitle = "Repository Not Found";
      suggestions = [
        "Check that the repository exists",
        "Make sure the URL is correct",
        "Try refreshing the page"
      ];
    } else if (message.includes("tree")) {
      errorTitle = "Could Not Load Repository Files";
      suggestions = [
        "The repository might be empty",
        "Try refreshing the page",
        "Check your internet connection"
      ];
    }
    content.innerHTML = `
            <div style="padding: 16px;">
                <div class="error">
                    <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">${errorTitle}</div>
                    <div style="margin-bottom: 12px;">${errorMessage}</div>
                    ${suggestions.length > 0 ? `
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #da3633;">
                            <div style="font-weight: 500; font-size: 12px; margin-bottom: 6px;">Suggestions:</div>
                            <ul style="margin: 0; padding-left: 20px; font-size: 12px;">
                                ${suggestions.map((s) => `<li style="margin-bottom: 4px;">${s}</li>`).join("")}
                            </ul>
                        </div>
                    ` : ""}
                </div>
            </div>
        `;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(init, 500);
    }
  }).observe(document.body, { subtree: true, childList: true });
})();
