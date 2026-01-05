
(function () {
    'use strict';

    console.log('GitHub Codebase Navigator: Content script loaded');

    let eventCleanupFunctions = [];
    function registerCleanup(cleanupFn) {
        eventCleanupFunctions.push(cleanupFn);
    }
    function cleanupAllEventListeners() {
        eventCleanupFunctions.forEach(fn => {
            try {
                fn();
            } catch (e) {
                console.error('Cleanup error:', e);
            }
        });
        eventCleanupFunctions = [];
    }

    function showWarning(message) {
        const statusDiv = document.getElementById('rate-limit-status');
        if (statusDiv) {
            statusDiv.style.color = '#d29922';
            statusDiv.textContent = message;
        }
    }

    async function getStoredToken() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['github_token'], (result) => {
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

    async function clearToken() {
        return new Promise((resolve) => {
            chrome.storage.local.remove(['github_token'], () => {
                resolve();
            });
        });
    }

    async function getAuthHeaders() {
        const token = await getStoredToken();
        const headers = {
            'Accept': 'application/vnd.github.v3+json'
        };
        if (token) {
            headers['Authorization'] = `token ${token}`;
        }
        return headers;
    }

    // Configuration
    const CONFIG = {
        CACHE_DURATION: 30 * 60 * 1000, // 30 minutes
        MAX_FILES_IN_GRAPH: 60,
        API_RATE_LIMIT_WARNING: 10,
        MAX_SEARCH_RESULTS: 30,
        MAX_KEY_FILES_PREVIEW: 3
    };

    async function fetchCommitHistory(owner, repo, filePath = null) {
        const headers = await getAuthHeaders();
        const url = filePath
            ? `${GITHUB_API}/repos/${owner}/${repo}/commits?path=${filePath}&per_page=100`
            : `${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=100`;

        try {
            const response = await fetch(url, { headers });
            if (!response.ok) return [];
            return await response.json();
        } catch (error) {
            console.error('Error fetching commit history:', error);
            return [];
        }
    }

    async function analyzeFileEvolution(owner, repo, filePath) {
        const commits = await fetchCommitHistory(owner, repo, filePath);
        const evolution = [];

        for (const commit of commits.slice(0, 20)) {
            evolution.push({
                sha: commit.sha,
                message: commit.commit.message.split('\n')[0],
                author: commit.commit.author.name,
                date: commit.commit.author.date,
                url: commit.html_url
            });
        }

        return evolution;
    }

    async function detectDeletedFiles(owner, repo) {
        const headers = await getAuthHeaders();
        const commits = await fetchCommitHistory(owner, repo);
        const deleted = new Map();

        for (const commit of commits.slice(0, 50)) {
            try {
                const detailUrl = `${GITHUB_API}/repos/${owner}/${repo}/commits/${commit.sha}`;
                const detailResponse = await fetch(detailUrl, { headers });
                if (!detailResponse.ok) continue;

                const detail = await detailResponse.json();
                if (detail.files) {
                    detail.files.forEach(file => {
                        if (file.status === 'removed') {
                            if (!deleted.has(file.filename)) {
                                deleted.set(file.filename, {
                                    path: file.filename,
                                    deletedAt: commit.commit.author.date,
                                    deletedBy: commit.commit.author.name,
                                    commitMessage: commit.commit.message.split('\n')[0],
                                    commitUrl: commit.html_url
                                });
                            }
                        }
                    });
                }
            } catch (error) {
                continue;
            }
        }

        return Array.from(deleted.values()).slice(0, 10);
    }

    function analyzeRepositoryGrowth(commits) {
        if (!commits || !Array.isArray(commits) || commits.length === 0) {
            return [];
        }
        
        const validCommits = commits.filter(commit => 
            commit && commit.commit && commit.commit.author && commit.commit.author.date
        );
        
        if (validCommits.length === 0) {
            return [];
        }
        
        // Try months first
        const monthlyData = {};
        validCommits.forEach(commit => {
            try {
                const date = new Date(commit.commit.author.date);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                
                if (!monthlyData[monthKey]) {
                    monthlyData[monthKey] = {
                        key: monthKey,
                        label: monthKey,
                        commits: 0,
                        date: date,
                        unit: 'month'
                    };
                }
                monthlyData[monthKey].commits++;
            } catch (e) {
                console.warn('Invalid commit date:', e);
            }
        });
        
        const monthlyTimeline = Object.values(monthlyData).sort((a, b) => a.date - b.date);
        
        // If we have 2+ months of data, use monthly view
        if (monthlyTimeline.length >= 2) {
            let totalCommits = 0;
            const result = monthlyTimeline.map(month => {
                totalCommits += month.commits;
                return {
                    label: month.label,
                    commits: month.commits,
                    cumulative: totalCommits,
                    unit: 'month'
                };
            });
            return result.slice(-12); // Last 12 months
        }
        
        // Try weeks if not enough months
        const weeklyData = {};
        validCommits.forEach(commit => {
            try {
                const date = new Date(commit.commit.author.date);
                const weekStart = new Date(date);
                weekStart.setDate(date.getDate() - date.getDay()); // Start of week
                const weekKey = weekStart.toISOString().split('T')[0];
                
                if (!weeklyData[weekKey]) {
                    weeklyData[weekKey] = {
                        key: weekKey,
                        label: `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
                        commits: 0,
                        date: weekStart,
                        unit: 'week'
                    };
                }
                weeklyData[weekKey].commits++;
            } catch (e) {
                console.warn('Invalid commit date:', e);
            }
        });
        
        const weeklyTimeline = Object.values(weeklyData).sort((a, b) => a.date - b.date);
        
        // If we have 2+ weeks of data, use weekly view
        if (weeklyTimeline.length >= 2) {
            let totalCommits = 0;
            const result = weeklyTimeline.map(week => {
                totalCommits += week.commits;
                return {
                    label: week.label,
                    commits: week.commits,
                    cumulative: totalCommits,
                    unit: 'week'
                };
            });
            return result.slice(-12); // Last 12 weeks
        }
        
        // Fall back to daily view for very new repos
        const dailyData = {};
        validCommits.forEach(commit => {
            try {
                const date = new Date(commit.commit.author.date);
                const dayKey = date.toISOString().split('T')[0];
                
                if (!dailyData[dayKey]) {
                    dailyData[dayKey] = {
                        key: dayKey,
                        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        commits: 0,
                        date: date,
                        unit: 'day'
                    };
                }
                dailyData[dayKey].commits++;
            } catch (e) {
                console.warn('Invalid commit date:', e);
            }
        });
        
        const dailyTimeline = Object.values(dailyData).sort((a, b) => a.date - b.date);
        
        if (dailyTimeline.length >= 2) {
            let totalCommits = 0;
            const result = dailyTimeline.map(day => {
                totalCommits += day.commits;
                return {
                    label: day.label,
                    commits: day.commits,
                    cumulative: totalCommits,
                    unit: 'day'
                };
            });
            return result.slice(-14); // Last 14 days
        }
        
        // If only 1 day with commits, still show it
        if (dailyTimeline.length === 1) {
            return [{
                label: dailyTimeline[0].label,
                commits: dailyTimeline[0].commits,
                cumulative: dailyTimeline[0].commits,
                unit: 'day'
            }];
        }
        
        return [];
    }

    function fuzzyMatch(text, query) {
        text = text.toLowerCase();
        query = query.toLowerCase();

        let textIndex = 0;
        let queryIndex = 0;
        let score = 0;
        let consecutiveMatches = 0;

        while (textIndex < text.length && queryIndex < query.length) {
            if (text[textIndex] === query[queryIndex]) {
                queryIndex++;
                consecutiveMatches++;
                score += consecutiveMatches * 10; // Bonus for consecutive matches
            } else {
                consecutiveMatches = 0;
            }
            textIndex++;
        }

        if (queryIndex === query.length) {
            // All characters matched, bonus for exact prefix match
            if (text.startsWith(query)) score += 100;
            return score;
        }

        return 0; // No match
    }

    const GITHUB_API = 'https://api.github.com';

    // State
    let globalData = null;
    let repoCache = {};
    let rateLimitInterval = null;
    let globalDefaultBranch = 'main';


    function init() {
        const path = window.location.pathname.split('/').filter(p => p);
        console.log('Current path:', path);

        if (path.length >= 2) {
            console.log('Valid repo page, injecting button');
            injectButton();
        }
    }

    function injectButton() {
        const existing = document.getElementById('codebase-nav-button');
        if (existing) return;
    
        const container = document.createElement('div');
        container.id = 'codebase-nav-button';
        container.style.cssText = `
            position: fixed !important;
            bottom: 30px !important;
            right: 30px !important;
            z-index: 999999 !important;
            transition: right 0.3s ease !important;
        `;
    
        const button = document.createElement('button');
        button.textContent = 'Analyze Codebase';
        button.style.cssText = `
            background: #238636 !important;
            color: #ffffff !important;
            border: none !important;
            padding: 14px 28px !important;
            border-radius: 6px !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            cursor: pointer !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 0 0 rgba(35, 134, 54, 0.7) !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
            transition: background 0.2s, transform 0.2s !important;
            animation: buttonPulse 2s ease-in-out infinite !important;
            position: relative !important;
            overflow: hidden !important;
        `;
    
        // Add keyframe animations to the page
        if (!document.getElementById('gitnav-button-animations')) {
            const style = document.createElement('style');
            style.id = 'gitnav-button-animations';
            style.textContent = `
                @keyframes buttonPulse {
                    0%, 100% {
                        box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 0 0 rgba(35, 134, 54, 0.7);
                    }
                    50% {
                        box-shadow: 0 4px 12px rgba(0,0,0,0.4), 0 0 0 8px rgba(35, 134, 54, 0);
                    }
                }
                
                @keyframes shimmer {
                    0% {
                        left: -100%;
                    }
                    100% {
                        left: 100%;
                    }
                }
                
                #codebase-nav-button button::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: -100%;
                    width: 50%;
                    height: 100%;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
                    animation: shimmer 3s ease-in-out infinite;
                }
            `;
            document.head.appendChild(style);
        }
    
        button.onmouseover = () => {
            button.style.background = '#2ea043 !important';
            button.style.transform = 'scale(1.05) !important';
            button.style.animation = 'none !important';
        };
    
        button.onmouseout = () => {
            button.style.background = '#238636 !important';
            button.style.transform = 'scale(1) !important';
            button.style.animation = 'buttonPulse 2s ease-in-out infinite !important';
        };
    
        // CRITICAL FIX: Prevent the click from affecting GitHub's page
        button.onclick = (e) => {
            // Stop ALL event propagation
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            // NUCLEAR: Temporarily disable ALL input fields on the page
            const allInputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
            const disabledInputs = [];
            
            allInputs.forEach(input => {
                if (!input.disabled && !input.closest('#codebase-navigator-sidebar')) {
                    input.disabled = true;
                    input.style.pointerEvents = 'none';
                    disabledInputs.push(input);
                }
            });
            
            // Blur any currently focused element (especially GitHub's search)
            if (document.activeElement) {
                document.activeElement.blur();
            }
            
            // Remove focus from the button itself
            button.blur();
            
            // Focus the body to ensure nothing else gets focus
            document.body.focus();
            
            // Call openSidebar and re-enable inputs after
            setTimeout(() => {
                openSidebar();
                
                // Re-enable inputs after 500ms
                setTimeout(() => {
                    disabledInputs.forEach(input => {
                        input.disabled = false;
                        input.style.pointerEvents = '';
                    });
                }, 500);
            }, 10);
        };
        
        // EXTRA: Prevent mousedown/mouseup from propagating too
        button.onmousedown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        
        button.onmouseup = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        
        // NUCLEAR: Prevent any keyboard events too
        button.onkeydown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        
        button.onkeyup = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        
        button.onkeypress = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
    
        container.appendChild(button);
        document.body.appendChild(container);
    
        console.log('Button injected successfully');
    }

    // Update the openSidebar() function to move the button:

    async function openSidebar() {
        console.log('Button clicked!');
        
        // STEP 1: Disable ALL GitHub inputs FIRST
        const githubInputs = Array.from(document.querySelectorAll('input, textarea'))
            .filter(el => !el.closest('#codebase-navigator-sidebar'));
        
        githubInputs.forEach(input => {
            input.dataset.wasDisabled = input.disabled;
            input.disabled = true;
            input.readOnly = true;
            input.value = ''; // Clear any autofilled values
        });
        
        // STEP 2: Blur any active element
        if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
        
        // STEP 3: Clear any selections
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        }
        
        // STEP 4: Focus body to ensure nothing else gets focus
        document.body.focus();
    
        const existing = document.getElementById('codebase-navigator-sidebar');
        const buttonContainer = document.getElementById('codebase-nav-button');
    
        if (existing) {
            existing.remove();
            // Move button back to original position
            if (buttonContainer) {
                buttonContainer.style.right = '30px';
            }
            
            // Re-enable GitHub inputs
            githubInputs.forEach(input => {
                input.disabled = input.dataset.wasDisabled === 'true';
                input.readOnly = false;
                delete input.dataset.wasDisabled;
            });
            
            return;
        }
    
        // Move button to the left to avoid sidebar
        if (buttonContainer) {
            buttonContainer.style.right = '530px';
        }
    
        const path = window.location.pathname.split('/').filter(p => p);
        const owner = path[0];
        const repo = path[1];
    
        console.log('Opening sidebar for:', owner, '/', repo);
    
        const sidebar = createSidebar(owner, repo);
        
        // Add anti-autofill attribute to the sidebar itself
        sidebar.setAttribute('data-lpignore', 'true');
        sidebar.setAttribute('data-1p-ignore', 'true');
        
        document.body.appendChild(sidebar);
        
        // Re-enable GitHub inputs after sidebar is rendered
        setTimeout(() => {
            githubInputs.forEach(input => {
                input.disabled = input.dataset.wasDisabled === 'true';
                input.readOnly = false;
                delete input.dataset.wasDisabled;
            });
        }, 1000);
    
        try {
            const data = await fetchRepoData(owner, repo);
            globalData = data;
            renderSidebar(sidebar, owner, repo, data);
        } catch (error) {
            console.error('Error:', error);
            showError(sidebar, error.message);
        }
    }

    function createSidebar(owner, repo) {
        const sidebar = document.createElement('div');
        sidebar.id = 'codebase-navigator-sidebar';
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

          .search-filter-btn {
            padding: 6px 12px;
            background: #21262d;
            border: 1px solid #30363d;
            border-radius: 6px;
            color: #8b949e;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
          }
          
          .search-filter-btn:hover {
            background: #30363d;
            color: #c9d1d9;
          }
          
          .search-filter-btn.active {
            background: #238636;
            color: #ffffff;
            border-color: #238636;
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
          .nav-tabs {
            display: flex;
            background: #161b22;
            border-bottom: 1px solid #30363d;
            position: sticky;
            top: 64px;
            z-index: 9;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: thin;
            scrollbar-color: #30363d #161b22;
          }
          
          .nav-tabs::-webkit-scrollbar {
            height: 4px;
          }
          
          .nav-tabs::-webkit-scrollbar-track {
            background: #161b22;
          }
          
          .nav-tabs::-webkit-scrollbar-thumb {
            background: #30363d;
            border-radius: 2px;
          }
          
          .nav-tabs::-webkit-scrollbar-thumb:hover {
            background: #484f58;
          }
          
          .nav-tab {
            flex-shrink: 0;
            min-width: 65px;
            max-width: 85px;
            padding: 10px 8px;
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
            overflow: hidden;
            text-overflow: ellipsis;
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
            display: block; 
            position: relative;
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
            flex-wrap: wrap;
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
    <img src="${chrome.runtime.getURL('icons/logo32light.png')}" 
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
          <button class="nav-tab" data-tab="tools">Tools</button>
          <button class="nav-tab" data-tab="search">Search</button>
          <button class="nav-tab" data-tab="insights">Insights</button>
          <button class="nav-tab" data-tab="metrics">Metrics</button>
          <button class="nav-tab" data-tab="tree">Tree</button>
          <button class="nav-tab" data-tab="contributors">People</button>
          <button class="nav-tab" data-tab="dependencies">Deps</button>
          <button class="nav-tab" data-tab="tech">Tech</button>
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

        sidebar.querySelector('#close-sidebar').onclick = () => {
            if (rateLimitInterval) {
                clearInterval(rateLimitInterval);
                rateLimitInterval = null;
            }

            const buttonContainer = document.getElementById('codebase-nav-button');
            if (buttonContainer) {
                buttonContainer.style.right = '30px';
            }

            cleanupAllEventListeners();
            sidebar.remove();
        };

        sidebar.querySelectorAll('div[title*="commits"]').forEach(dot => {
            dot.addEventListener('mouseenter', () => {
                dot.style.transform = 'scale(1.5)';
                dot.style.zIndex = '10';
            });
        
            dot.addEventListener('mouseleave', () => {
                dot.style.transform = 'scale(1)';
                dot.style.zIndex = '1';
            });
        });

        const tokenInput = sidebar.querySelector('#github-token-input');
        const saveTokenBtn = sidebar.querySelector('#save-token-btn');
        const tokenStatus = sidebar.querySelector('#token-status');

        if (saveTokenBtn && tokenInput) {
            saveTokenBtn.onclick = async () => {
                const token = tokenInput.value.trim();
                if (!token) {
                    tokenStatus.style.display = 'flex';
                    tokenStatus.className = 'token-status error';
                    tokenStatus.innerHTML = '❌ Please enter a token';
                    return;
                }

                // Test token
                try {
                    const headers = { 'Authorization': `token ${token}` };
                    const test = await fetch(`${GITHUB_API}/user`, { headers });

                    if (test.ok) {
                        await saveToken(token);
                        tokenStatus.style.display = 'flex';
                        tokenStatus.className = 'token-status success';
                        tokenStatus.innerHTML = 'Token saved! Refreshing...';

                        setTimeout(() => {
                            location.reload();
                        }, 1500);
                    } else {
                        tokenStatus.style.display = 'flex';
                        tokenStatus.className = 'token-status error';
                        tokenStatus.innerHTML = 'Invalid token';
                    }
                } catch (e) {
                    tokenStatus.style.display = 'flex';
                    tokenStatus.className = 'token-status error';
                    tokenStatus.innerHTML = 'Error validating token';
                }
            };
        }


        return sidebar;
    }


    async function updateRateLimitDisplay() {
        try {
            const headers = await getAuthHeaders();
            const response = await fetch(`${GITHUB_API}/rate_limit`, { headers });
            
            if (!response.ok) {
                console.warn('Could not fetch rate limit');
                return;
            }
            
            const data = await response.json();
            const display = document.getElementById('rate-limit-status');
    
            if (display) {
                const remaining = data.rate.remaining;
                const limit = data.rate.limit;
                const resetTime = new Date(data.rate.reset * 1000).toLocaleTimeString();
    
                if (remaining < CONFIG.API_RATE_LIMIT_WARNING) {
                    display.style.color = '#da3633';
                    display.textContent = `${remaining}/${limit} API requests left (resets at ${resetTime})`;
                } else {
                    display.style.color = '#8b949e';
                    display.textContent = `${remaining}/${limit} API requests remaining`;
                }
            }
        } catch (e) {
            
        }
    }

    async function fetchRepoData(owner, repo) {
        const cacheKey = `${owner}/${repo}`;
        const now = Date.now();
    
        // Check cache first
        if (repoCache[cacheKey] && (now - repoCache[cacheKey].timestamp) < CONFIG.CACHE_DURATION) {
            console.log('Using cached data for', cacheKey);
            // ADDED: Restore the default branch from cache
            globalDefaultBranch = repoCache[cacheKey].defaultBranch || 'main';
            return repoCache[cacheKey].data;
        }
    
        console.log('Fetching:', `${GITHUB_API}/repos/${owner}/${repo}`);
    
        try {
            const headers = await getAuthHeaders();
    
            // Fetch repo info first
            const infoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
    
            if (!infoRes.ok) {
                if (infoRes.status === 403) {
                    const rateLimitRes = await fetch(`${GITHUB_API}/rate_limit`, { headers });
                    const rateLimit = await rateLimitRes.json();
                    const resetTime = new Date(rateLimit.rate.reset * 1000);
                    const timeLeft = Math.ceil((rateLimit.rate.reset * 1000 - Date.now()) / 60000);
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
            const defaultBranch = info.default_branch || 'main';
            
            // ADDED: Store the default branch globally
            globalDefaultBranch = defaultBranch;
    
            console.log('Default branch:', defaultBranch);
    
            // Try default branch first, then fallback
            let treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, { headers });
    
            if (!treeRes.ok) {
                console.log(`Branch ${defaultBranch} failed, trying alternative...`);
                const altBranch = defaultBranch === 'main' ? 'master' : 'main';
                treeRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/trees/${altBranch}?recursive=1`, { headers });
    
                if (!treeRes.ok) {
                    throw new Error(`Could not fetch repository tree. Tried branches: ${defaultBranch}, ${altBranch}`);
                }
                // ADDED: Update global branch if we used alternative
                globalDefaultBranch = altBranch;
            }
    
            // Fetch commits and contributors (non-blocking)
            const [commitsRes, contributorsRes] = await Promise.all([
                fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=30`, { headers }).catch(() => null),
                fetch(`${GITHUB_API}/repos/${owner}/${repo}/contributors?per_page=10`, { headers }).catch(() => null)
            ]);
    
            const tree = await treeRes.json();
            const commits = commitsRes && commitsRes.ok ? await commitsRes.json() : [];
            const contributors = contributorsRes && contributorsRes.ok ? await contributorsRes.json() : [];
    
            const files = tree.tree.filter(f => f.type === 'blob');
            const folders = tree.tree.filter(f => f.type === 'tree');
    
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
    
            // Store in cache
            repoCache[cacheKey] = {
                data: data,
                timestamp: now,
                defaultBranch: globalDefaultBranch  // ADDED: Store default branch in cache
            };
    
            console.log('✓ Data cached for', cacheKey);
    
            return data;
        } catch (error) {
            console.error('Fetch error:', error);
            throw error;
        }
    }

    async function extractDependencies(files, owner, repo) {
        const deps = { npm: [], python: [], flutter: [], rust: [], go: [], maven: [], gradle: [] };

        const packageJson = files.find(f => f.path === 'package.json');
        if (packageJson) {
            try {
                const content = await fetchFileContent(owner, repo, 'package.json');
                const pkg = JSON.parse(content);
                if (pkg.dependencies) {
                    deps.npm = Object.entries(pkg.dependencies).map(([name, version]) => ({
                        name,
                        version,
                        outdated: isVersionOutdated(version)
                    }));
                }
            } catch (e) { }
        }

        const requirementsTxt = files.find(f => f.path === 'requirements.txt');
        if (requirementsTxt) {
            try {
                const content = await fetchFileContent(owner, repo, 'requirements.txt');
                deps.python = content.split('\n')
                    .filter(line => line.trim() && !line.startsWith('#'))
                    .map(line => {
                        const [name, version] = line.split('==');
                        return {
                            name: name.trim(),
                            version: version || 'latest',
                            outdated: false
                        };
                    });
            } catch (e) { }
        }

        const pubspecYaml = files.find(f => f.path === 'pubspec.yaml');
        if (pubspecYaml) {
            try {
                const content = await fetchFileContent(owner, repo, 'pubspec.yaml');
                const lines = content.split('\n');
                let inDeps = false;
                lines.forEach(line => {
                    if (line.trim() === 'dependencies:') inDeps = true;
                    else if (line.trim() === 'dev_dependencies:') inDeps = false;
                    else if (inDeps && line.includes(':')) {
                        const match = line.match(/(\w+):\s*(.+)/);
                        if (match) deps.flutter.push({
                            name: match[1],
                            version: match[2].trim(),
                            outdated: false
                        });
                    }
                });
            } catch (e) { }
        }

        const cargoToml = files.find(f => f.path === 'Cargo.toml');
        if (cargoToml) {
            try {
                const content = await fetchFileContent(owner, repo, 'Cargo.toml');
                const lines = content.split('\n');
                let inDeps = false;
                lines.forEach(line => {
                    if (line.trim() === '[dependencies]') inDeps = true;
                    else if (line.trim().startsWith('[') && line.trim() !== '[dependencies]') inDeps = false;
                    else if (inDeps && line.includes('=')) {
                        const match = line.match(/(\S+)\s*=\s*"(.+)"/);
                        if (match) deps.rust.push({
                            name: match[1],
                            version: match[2],
                            outdated: false
                        });
                    }
                });
            } catch (e) { }
        }

        return deps;
    }


    function isVersionOutdated(version) {
        return version.includes('^') || version.includes('~');
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

        const fileNames = files.map(f => f.path.toLowerCase());
        const allContent = fileNames.join(' ');

        if (fileNames.some(f => f === 'package.json')) {
            stack.backend.push({ name: 'Node.js' });
        }
        if (allContent.includes('react')) {
            stack.frontend.push({ name: 'React' });
        }
        if (allContent.includes('vue')) {
            stack.frontend.push({ name: 'Vue.js' });
        }
        if (allContent.includes('angular')) {
            stack.frontend.push({ name: 'Angular' });
        }
        if (allContent.includes('express')) {
            stack.backend.push({ name: 'Express' });
        }
        if (allContent.includes('django') || fileNames.some(f => f.includes('django'))) {
            stack.backend.push({ name: 'Django' });
        }
        if (allContent.includes('flask')) {
            stack.backend.push({ name: 'Flask' });
        }
        if (fileNames.some(f => f === 'pubspec.yaml')) {
            stack.mobile.push({ name: 'Flutter' });
        }
        if (fileNames.some(f => f === 'cargo.toml')) {
            stack.backend.push({ name: 'Rust' });
        }
        if (fileNames.some(f => f === 'go.mod')) {
            stack.backend.push({ name: 'Go' });
        }
        if (allContent.includes('mongodb') || allContent.includes('mongoose')) {
            stack.database.push({ name: 'MongoDB' });
        }
        if (allContent.includes('postgresql') || allContent.includes('postgres')) {
            stack.database.push({ name: 'PostgreSQL' });
        }
        if (allContent.includes('mysql')) {
            stack.database.push({ name: 'MySQL' });
        }
        if (allContent.includes('redis')) {
            stack.database.push({ name: 'Redis' });
        }
        if (fileNames.some(f => f === 'dockerfile' || f.includes('docker-compose'))) {
            stack.devops.push({ name: 'Docker' });
        }
        if (fileNames.some(f => f.includes('.github/workflows'))) {
            stack.devops.push({ name: 'GitHub Actions' });
        }
        if (fileNames.some(f => f === '.circleci/config.yml')) {
            stack.devops.push({ name: 'CircleCI' });
        }
        if (allContent.includes('jest') || fileNames.some(f => f.includes('jest.config'))) {
            stack.testing.push({ name: 'Jest' });
        }
        if (allContent.includes('pytest') || fileNames.some(f => f.includes('pytest'))) {
            stack.testing.push({ name: 'Pytest' });
        }
        if (allContent.includes('webpack')) {
            stack.devops.push({ name: 'Webpack' });
        }
        if (allContent.includes('vite')) {
            stack.devops.push({ name: 'Vite' });
        }
        if (fileNames.some(f => f.includes('build.gradle') || f.includes('pom.xml'))) {
            stack.backend.push({ name: 'Java' });
        }
        if (fileNames.some(f => f.includes('spring'))) {
            stack.backend.push({ name: 'Spring Boot' });
        }

        return stack;
    }

    function calculateCodeMetrics(files, commits) {
        const totalLines = files.reduce((sum, f) => sum + (f.size || 0), 0) / 50;

        const commitsByMonth = {};
        commits.forEach(commit => {
            const month = new Date(commit.commit.author.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
            commitsByMonth[month] = (commitsByMonth[month] || 0) + 1;
        });

        const avgCommitsPerMonth = commits.length > 0 ? Math.round(commits.length / Object.keys(commitsByMonth).length) : 0;

        const codeFiles = files.filter(f =>
            f.path.match(/\.(js|jsx|ts|tsx|py|dart|rs|go|java|cpp|c)$/i)
        );

        const avgFileSize = codeFiles.length > 0
            ? Math.round(codeFiles.reduce((sum, f) => sum + (f.size || 0), 0) / codeFiles.length)
            : 0;

        return {
            estimatedLines: Math.round(totalLines),
            codeFiles: codeFiles.length,
            avgFileSize,
            commitsByMonth,
            avgCommitsPerMonth,
            complexity: calculateComplexityScore(files)
        };
    }

    function calculatePerformanceMetrics(files, dependencies) {
        const metrics = {
            bundleSize: {
                total: 0,
                byType: {},
                largest: []
            },
            unusedDeps: [],
            heavyDeps: []
        };
    
        const bundleFiles = files.filter(f => 
            f.path.match(/\.(js|jsx|ts|tsx|css|scss|sass|json)$/i) &&
            !f.path.includes('node_modules') &&
            !f.path.includes('test') &&
            !f.path.includes('spec')
        );
    
        bundleFiles.forEach(file => {
            const ext = file.path.split('.').pop().toLowerCase();
            metrics.bundleSize.total += file.size || 0;
            metrics.bundleSize.byType[ext] = (metrics.bundleSize.byType[ext] || 0) + (file.size || 0);
        });
    
        metrics.bundleSize.largest = bundleFiles
            .filter(f => f.size > 50000)
            .sort((a, b) => b.size - a.size)
            .slice(0, 10)
            .map(f => ({
                path: f.path,
                size: f.size,
                percentage: ((f.size / metrics.bundleSize.total) * 100).toFixed(1)
            }));
    
        const allDeps = [
            ...dependencies.npm,
            ...dependencies.python,
            ...dependencies.flutter,
            ...dependencies.rust
        ];
    
        if (allDeps.length > 0) {
            const codeContent = files
                .filter(f => f.path.match(/\.(js|jsx|ts|tsx|py|dart|rs)$/i))
                .map(f => f.path.toLowerCase())
                .join(' ');
    
            metrics.unusedDeps = allDeps
                .filter(dep => {
                    const depName = dep.name.toLowerCase();
                    return !codeContent.includes(depName.replace(/-/g, ''));
                })
                .slice(0, 5)
                .map(dep => dep.name);
        }
    
        const heavyPackages = {
            'moment': '~300KB',
            'lodash': '~70KB',
            'axios': '~15KB',
            'react': '~40KB',
            'vue': '~90KB',
            'angular': '~500KB',
            'jquery': '~90KB',
            'bootstrap': '~150KB',
            '@material-ui/core': '~300KB',
            'antd': '~1.2MB',
            'chart.js': '~200KB'
        };
    
        allDeps.forEach(dep => {
            if (heavyPackages[dep.name]) {
                metrics.heavyDeps.push({
                    name: dep.name,
                    size: heavyPackages[dep.name],
                    alternative: getAlternative(dep.name)
                });
            }
        });
    
        return metrics;
    }

    function getAlternative(packageName) {
        const alternatives = {
            'moment': 'date-fns or dayjs',
            'lodash': 'lodash-es or native ES6',
            'jquery': 'Vanilla JS',
            'bootstrap': 'Tailwind CSS',
            '@material-ui/core': 'Headless UI or Radix',
            'antd': 'Shadcn/ui',
            'chart.js': 'Recharts or Victory'
        };
        return alternatives[packageName] || 'Check bundlephobia.com';
    }

    function calculateComplexityScore(files) {
        let score = 0;
        const deepNesting = files.filter(f => f.path.split('/').length > 5).length;
        const largeFiles = files.filter(f => f.size > 100000).length;

        if (deepNesting > 50) score += 30;
        else if (deepNesting > 20) score += 15;

        if (largeFiles > 10) score += 30;
        else if (largeFiles > 5) score += 15;

        if (files.length > 1000) score += 20;
        else if (files.length > 500) score += 10;

        return Math.min(100, score);
    }

    function calculateCodeQuality(files, data) {
        const scores = {
            maintainability: 100,
            testability: 100,
            documentation: 100,
            structure: 100,
            overall: 0
        };

        const issues = {
            maintainability: [],
            testability: [],
            documentation: [],
            structure: []
        };

        // Maintainability scoring
        const largeFiles = files.filter(f => f.size > 100000);
        if (largeFiles.length > 10) {
            scores.maintainability -= 30;
            issues.maintainability.push('Too many large files (>100KB)');
        } else if (largeFiles.length > 5) {
            scores.maintainability -= 15;
            issues.maintainability.push('Several large files detected');
        }

        const veryLargeFiles = files.filter(f => f.size > 500000);
        if (veryLargeFiles.length > 0) {
            scores.maintainability -= 20;
            issues.maintainability.push(`${veryLargeFiles.length} file(s) >500KB`);
        }

        // Deep nesting check
        const deeplyNested = files.filter(f => f.path.split('/').length > 6);
        if (deeplyNested.length > 20) {
            scores.maintainability -= 15;
            issues.maintainability.push('Deep folder nesting detected');
        }

        // Testability scoring
        const testFiles = files.filter(f =>
            f.path.includes('test') ||
            f.path.includes('spec') ||
            f.path.includes('__tests__') ||
            f.path.match(/\.(test|spec)\./i)
        );

        const codeFiles = files.filter(f =>
            f.path.match(/\.(js|jsx|ts|tsx|py|dart|rs|go|java|cpp|c)$/i)
        );

        const testCoverage = codeFiles.length > 0 ? (testFiles.length / codeFiles.length) * 100 : 0;

        if (testCoverage === 0) {
            scores.testability = 30;
            issues.testability.push('No test files found');
        } else if (testCoverage < 10) {
            scores.testability = 50;
            issues.testability.push('Very low test coverage');
        } else if (testCoverage < 20) {
            scores.testability = 70;
            issues.testability.push('Low test coverage');
        } else if (testCoverage < 30) {
            scores.testability = 85;
        }

        // Documentation scoring
        const readme = files.find(f => f.path.toLowerCase() === 'readme.md');
        const contributing = files.find(f => f.path.toLowerCase() === 'contributing.md');
        const changelog = files.find(f => f.path.toLowerCase() === 'changelog.md');
        const docFiles = files.filter(f =>
            f.path.match(/\.(md|txt|rst|adoc)$/i) ||
            f.path.toLowerCase().includes('doc')
        );

        if (!readme) {
            scores.documentation -= 40;
            issues.documentation.push('Missing README.md');
        } else if (readme.size < 500) {
            scores.documentation -= 20;
            issues.documentation.push('README is very short');
        }

        if (!contributing) {
            scores.documentation -= 15;
            issues.documentation.push('No CONTRIBUTING.md');
        }

        if (docFiles.length === 0) {
            scores.documentation -= 25;
            issues.documentation.push('No documentation files');
        } else if (docFiles.length < 3) {
            scores.documentation -= 10;
            issues.documentation.push('Limited documentation');
        }

        // Structure scoring
        const hasGitignore = files.some(f => f.path === '.gitignore');
        const hasLicense = files.some(f => f.path.toLowerCase().includes('license'));
        const hasConfig = files.some(f =>
            f.path === 'package.json' ||
            f.path === 'requirements.txt' ||
            f.path === 'Cargo.toml' ||
            f.path === 'go.mod'
        );

        if (!hasGitignore) {
            scores.structure -= 20;
            issues.structure.push('Missing .gitignore');
        }

        if (!hasLicense) {
            scores.structure -= 15;
            issues.structure.push('Missing LICENSE file');
        }

        if (!hasConfig) {
            scores.structure -= 10;
            issues.structure.push('No package manager config');
        }

        const srcFolder = files.some(f =>
            f.path.startsWith('src/') ||
            f.path.startsWith('lib/')
        );
        if (!srcFolder && codeFiles.length > 10) {
            scores.structure -= 15;
            issues.structure.push('No src/ or lib/ folder');
        }

        // Calculate overall score
        scores.overall = Math.round(
            (scores.maintainability + scores.testability + scores.documentation + scores.structure) / 4
        );

        return { scores, issues };
    }

    function analyzeFileRelationships(commits, files) {
        const relationships = new Map();
        const coChanges = new Map();

        commits.forEach(commit => {
            if (commit.files && commit.files.length > 1) {
                for (let i = 0; i < commit.files.length; i++) {
                    for (let j = i + 1; j < commit.files.length; j++) {
                        const file1 = commit.files[i].filename;
                        const file2 = commit.files[j].filename;

                        const key = [file1, file2].sort().join('::');
                        coChanges.set(key, (coChanges.get(key) || 0) + 1);
                    }
                }
            }
        });

        files.forEach(file => {
            const related = [];

            coChanges.forEach((count, key) => {
                const [f1, f2] = key.split('::');
                if (f1 === file.path || f2 === file.path) {
                    related.push({
                        file: f1 === file.path ? f2 : f1,
                        strength: count
                    });
                }
            });

            relationships.set(
                file.path,
                related.sort((a, b) => b.strength - a.strength).slice(0, 5)
            );
        });

        return relationships;
    }

    function findRelatedFilesByStructure(filePath, files) {
        const related = [];
        const fileName = filePath.split('/').pop();
        const fileDir = filePath.substring(0, filePath.lastIndexOf('/'));
        const baseName = fileName.replace(/\.(test|spec)\./i, '.').replace(/\.[^.]+$/, '');

        if (!filePath.match(/\.(test|spec)\./i)) {
            const testPatterns = [
                `${baseName}.test.js`,
                `${baseName}.test.ts`,
                `${baseName}.spec.js`,
                `${baseName}.spec.ts`,
                `${baseName}_test.py`,
                `${baseName}_spec.rb`
            ];

            testPatterns.forEach(pattern => {
                const testFile = files.find(f =>
                    f.path.endsWith(pattern) ||
                    f.path.includes(`__tests__/${pattern}`) ||
                    f.path.includes(`test/${pattern}`)
                );
                if (testFile) {
                    related.push({ file: testFile.path, type: 'Test file' });
                }
            });
        } else {
            const sourceName = baseName.replace(/\.(test|spec)$/i, '');
            const sourceFile = files.find(f =>
                f.path.includes(sourceName) &&
                !f.path.match(/\.(test|spec)\./i)
            );
            if (sourceFile) {
                related.push({ file: sourceFile.path, type: 'Source file' });
            }
        }

        const sameDir = files
            .filter(f =>
                f.path.startsWith(fileDir + '/') &&
                f.path !== filePath &&
                f.path.split('/').length === filePath.split('/').length
            )
            .slice(0, 3);

        sameDir.forEach(f => {
            related.push({ file: f.path, type: 'Same directory' });
        });

        if (fileName !== 'index.js' && fileName !== 'index.ts') {
            const indexFile = files.find(f =>
                f.path === `${fileDir}/index.js` ||
                f.path === `${fileDir}/index.ts`
            );
            if (indexFile) {
                related.push({ file: indexFile.path, type: 'Module index' });
            }
        }

        const similar = files
            .filter(f => {
                const fName = f.path.split('/').pop();
                const fBase = fName.replace(/\.[^.]+$/, '');
                return fBase.includes(baseName) && f.path !== filePath;
            })
            .slice(0, 2);

        similar.forEach(f => {
            related.push({ file: f.path, type: 'Similar name' });
        });

        return related;
    }

    function analyzeFileHotspots(commits, files) {
        const editCounts = new Map();

        commits.forEach(commit => {
            if (commit.files) {
                commit.files.forEach(file => {
                    const count = editCounts.get(file.filename) || 0;
                    editCounts.set(file.filename, count + 1);
                });
            }
        });

        const hotspots = Array.from(editCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([path, count]) => {
                const file = files.find(f => f.path === path);
                return {
                    path,
                    editCount: count,
                    size: file?.size || 0
                };
            });

        return hotspots;
    }


    function analyzeSecurityIssues(files, info) {
        const issues = [];

        const hasGitignore = files.some(f => f.path === '.gitignore');
        if (!hasGitignore) {
            issues.push({
                severity: 'medium',
                title: 'Missing .gitignore',
                description: 'No .gitignore file found. Sensitive files might be committed.'
            });
        }

        const hasEnvFile = files.some(f => f.path === '.env' || f.path === '.env.local');
        if (hasEnvFile) {
            issues.push({
                severity: 'high',
                title: 'Environment file in repository',
                description: '.env file detected. This may contain sensitive credentials.'
            });
        }

        const hasLockFile = files.some(f =>
            f.path === 'package-lock.json' ||
            f.path === 'yarn.lock' ||
            f.path === 'Cargo.lock' ||
            f.path === 'Pipfile.lock'
        );

        if (!hasLockFile && files.some(f => f.path === 'package.json')) {
            issues.push({
                severity: 'low',
                title: 'No lock file found',
                description: 'Consider using a lock file for reproducible builds.'
            });
        }

        const suspiciousFiles = files.filter(f =>
            f.path.toLowerCase().includes('password') ||
            f.path.toLowerCase().includes('secret') ||
            f.path.toLowerCase().includes('api_key') ||
            f.path.toLowerCase().includes('credentials')
        );

        if (suspiciousFiles.length > 0) {
            issues.push({
                severity: 'high',
                title: 'Suspicious files detected',
                description: `Found ${suspiciousFiles.length} file(s) with potentially sensitive names.`,
                files: suspiciousFiles.map(f => f.path)
            });
        }

        return issues;
    }

    async function fetchFileContent(owner, repo, path) {
        const headers = await getAuthHeaders(); // ADD THIS LINE
        const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, { headers }); // ADD { headers }
        if (!response.ok) throw new Error('Failed to fetch file');
        const data = await response.json();
        return atob(data.content);
    }

    function findKeyFiles(fileTree) {
        const keyPatterns = {
            'package.json': 'Node.js Config',
            'pubspec.yaml': 'Flutter Config',
            'requirements.txt': 'Python Config',
            'cargo.toml': 'Rust Config',
            'go.mod': 'Go Config',
            'pom.xml': 'Maven Config',
            'build.gradle': 'Gradle Config',
            'index.js': 'Entry Point',
            'main.py': 'Entry Point',
            'app.py': 'Entry Point',
            'main.dart': 'Entry Point',
            'main.go': 'Entry Point',
            'main.rs': 'Entry Point',
            'index.html': 'Frontend Entry',
            'dockerfile': 'Docker Config',
            '.gitignore': 'Git Config',
            'license': 'License',
            'makefile': 'Build Config'
        };

        const found = [];
        fileTree.forEach(item => {
            if (item.type !== 'blob') return;
            const fileName = item.path.split('/').pop().toLowerCase();
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

        files.forEach(file => {
            const path = file.path.toLowerCase();

            if (path.match(/\/(lib|src|components?|views?|pages?|widgets?|ui)\//i) ||
                path.match(/\.(dart|jsx?|tsx?|vue|svelte|css|scss|sass|less)$/i)) {
                categories.frontend.push(file);
            } else if (path.match(/\/(server|api|routes?|controllers?|models?|services?)\//i) ||
                path.match(/\.(py|java|go|rs|php|rb)$/i)) {
                categories.backend.push(file);
            } else if (path.match(/\.(json|ya?ml|toml|lock|config|ini)$/i) ||
                path.match(/^(package|pubspec|cargo|go\.mod|gemfile|dockerfile|makefile)/i)) {
                categories.config.push(file);
            } else if (path.match(/\/(test|__tests__|spec|e2e)\//i) ||
                path.match(/\.(test|spec)\./i) ||
                path.match(/_test\./i)) {
                categories.tests.push(file);
            } else if (path.match(/\.(md|txt|rst|adoc)$/i) ||
                path.match(/^(readme|contributing|changelog|license|authors)/i)) {
                categories.docs.push(file);
            }
        });

        return categories;
    }

    function buildFileTree(items) {
        const root = { name: '', type: 'folder', children: {}, files: [], path: '' };
    
        items.forEach(item => {
            // Skip invalid items
            if (!item || !item.path) return;
            
            const parts = item.path.split('/');
            let current = root;
    
            parts.forEach((part, index) => {
                // Skip empty parts
                if (!part) return;
                
                const isLast = index === parts.length - 1;
    
                if (isLast && item.type === 'blob') {
                    // Ensure files array exists
                    if (!current.files) {
                        current.files = [];
                    }
                    
                    current.files.push({
                        name: part,
                        path: item.path,
                        size: item.size,
                        type: 'file'
                    });
                } else {
                    // Ensure children object exists
                    if (!current.children) {
                        current.children = {};
                    }
                    
                    if (!current.children[part]) {
                        current.children[part] = {
                            name: part,
                            type: 'folder',
                            children: {},
                            files: [],
                            path: parts.slice(0, index + 1).join('/')
                        };
                    }
                    current = current.children[part];
                }
            });
        });
    
        return root;
    }

    function renderTimelineSection(timeline) {
        const gradientId = `timelineGradient-${Math.random().toString(36).substr(2, 9)}`;
        
        if (!timeline || timeline.length === 0) {
            return `
                <div class="section">
                    <h3 class="section-title">Repository Timeline</h3>
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 20px; text-align: center;">
                        <div style="color: #8b949e; font-size: 13px;">
                            No timeline data available
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Handle single data point case
        if (timeline.length === 1) {
            return `
                <div class="section">
                    <h3 class="section-title">Repository Timeline</h3>
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px;">
                        <div style="text-align: center;">
                            <div style="font-size: 11px; color: #8b949e; margin-bottom: 8px;">Total Commits</div>
                            <div style="font-size: 48px; color: #58a6ff; font-weight: 700;">${timeline[0].cumulative}</div>
                            <div style="font-size: 13px; color: #c9d1d9; margin-top: 8px; font-weight: 600;">${timeline[0].label}</div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        const maxCommits = Math.max(...timeline.map(t => t.cumulative));
        const firstLabel = timeline[0].label;
        const lastLabel = timeline[timeline.length - 1].label;
        const timeUnit = timeline[0].unit || 'month';
        
        // Calculate point positions with proper percentages
        const points = timeline.map((point, idx) => {
            const xPercent = 2 + (idx / (timeline.length - 1)) * 96; // 2% to 98%
            const yPercent = 20 + (1 - (point.cumulative / maxCommits)) * 66.67; // 20% to 86.67%
            return { 
                xPercent, 
                yPercent,
                label: point.label,
                commits: point.cumulative
            };
        });
        
        return `
            <div class="section">
                <h3 class="section-title">Repository Timeline</h3>
                
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div>
                            <div style="font-size: 11px; color: #8b949e;">First Activity</div>
                            <div style="font-size: 14px; color: #c9d1d9; font-weight: 600;">${firstLabel}</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 11px; color: #8b949e;">Total Commits</div>
                            <div style="font-size: 24px; color: #58a6ff; font-weight: 700;">${timeline[timeline.length - 1].cumulative}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 11px; color: #8b949e;">Latest Activity</div>
                            <div style="font-size: 14px; color: #c9d1d9; font-weight: 600;">${lastLabel}</div>
                        </div>
                    </div>
                    
                    <div style="position: relative; height: 120px; margin-top: 20px; padding: 0 10px;">
                        <!-- SVG for line and gradient area -->
                        <svg width="100%" height="120" viewBox="0 0 100 100" preserveAspectRatio="none" 
                             style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
                            <defs>
                                <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
                                    <stop offset="0%" style="stop-color:#58a6ff;stop-opacity:0.3" />
                                    <stop offset="100%" style="stop-color:#58a6ff;stop-opacity:0" />
                                </linearGradient>
                            </defs>
                            
                            <!-- Filled area under the line -->
                            <polygon 
                                points="${points.map(p => `${p.xPercent},${p.yPercent}`).join(' ')} 98,100 2,100" 
                                fill="url(#${gradientId})" 
                                stroke="none" />
                            
                            <!-- Main line - THICKER NOW -->
                            <polyline
                                points="${points.map(p => `${p.xPercent},${p.yPercent}`).join(' ')}"
                                fill="none"
                                stroke="#58a6ff"
                                stroke-width="1.2"
                                vector-effect="non-scaling-stroke"
                                stroke-linecap="round"
                                stroke-linejoin="round" />
                        </svg>
                        
                        <!-- Circles as absolutely positioned divs -->
                        ${points.map(p => `
                            <div style="
                                position: absolute;
                                left: ${p.xPercent}%;
                                top: ${p.yPercent}%;
                                width: 10px;
                                height: 10px;
                                margin-left: -5px;
                                margin-top: -5px;
                                background: #58a6ff;
                                border: 2px solid #0d1117;
                                border-radius: 50%;
                                cursor: pointer;
                                transition: all 0.2s ease;
                            " 
                            title="${p.label}: ${p.commits} commits"></div>
                            `).join('')}
                            </div>
                    
                    <div style="display: flex; justify-content: space-between; margin-top: 12px; font-size: 10px; color: #8b949e;">
                        ${timeline.filter((_, idx) => idx % Math.ceil(timeline.length / 4) === 0).map(t => 
                            `<div>${t.label}</div>`
                        ).join('')}
                    </div>
                </div>
                
                <button class="btn-secondary" id="view-deleted-files-btn" style="width: 100%; margin-bottom: 8px;">
                    View Deleted Files (Ghost Mode)
                </button>
                
                <div id="deleted-files-container" style="display: none;"></div>
            </div>
        `;
    }



    function renderFileTree(node, owner, repo, level = 0) {
        let html = '';

        const folders = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
        folders.forEach(folder => {
            const hasContent = Object.keys(folder.children).length > 0 || folder.files.length > 0;
            html += `
          <div class="tree-item" style="padding-left: ${level * 20 + 8}px;">
            <span class="tree-toggle">${hasContent ? '▶' : ' '}</span>
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
        files.forEach(file => {
            html += `
          <div class="tree-item" style="padding-left: ${level * 20 + 8}px;" data-path="${file.path}">
            <span class="tree-toggle"></span>
            <span class="tree-icon">FILE</span>
            <span class="tree-name file">${file.name}</span>
            ${file.size ? `<span style="color: #8b949e; font-size: 11px; margin-left: auto;">${formatBytes(file.size)}</span>` : ''}
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

        files.forEach(file => {
            const ext = file.path.split('.').pop().toLowerCase();
            if (ext && ext !== file.path) {
                extensions[ext] = (extensions[ext] || 0) + 1;
            }
            totalSize += file.size || 0;

            if (file.size > 100000) largFiles.push(file);

            if (!largestFile || (file.size && file.size > (largestFile.size || 0))) {
                largestFile = file;
            }
        });

        const topExtensions = Object.entries(extensions)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);

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

        const hasTests = files.some(f => f.path.includes('test'));
        if (!hasTests) score -= 15;

        const hasReadme = files.some(f => f.path.toLowerCase() === 'readme.md');
        if (!hasReadme) score -= 10;

        const hasLicense = files.some(f => f.path.toLowerCase().includes('license'));
        if (!hasLicense) score -= 5;

        if (files.length > 1000) score -= 10;

        return Math.max(0, Math.min(100, score));
    }

    function generateOnboardingSteps(data) {
        const steps = [];

        const configs = data.keyFiles.filter(f => f.type.includes('Config'));
        if (configs.length > 0) {
            const config = configs[0];
            let command = 'Check configuration file';
            if (config.name === 'package.json') command = 'npm install';
            else if (config.name === 'pubspec.yaml') command = 'flutter pub get';
            else if (config.name === 'requirements.txt') command = 'pip install -r requirements.txt';
            else if (config.name === 'cargo.toml') command = 'cargo build';
            else if (config.name === 'go.mod') command = 'go mod download';

            steps.push({ title: 'Install Dependencies', file: config.path, command: command });
        }

        const entry = data.keyFiles.find(f => f.type === 'Entry Point');
        if (entry) {
            steps.push({ title: 'Explore Entry Point', file: entry.path });
        }

        if (data.categorized.frontend.length > 0) {
            const mainFolder = data.categorized.frontend[0].path.split('/')[0];
            steps.push({ title: 'Explore Main Code', file: mainFolder + '/' });
        } else if (data.categorized.backend.length > 0) {
            const mainFolder = data.categorized.backend[0].path.split('/')[0];
            steps.push({ title: 'Explore Main Code', file: mainFolder + '/' });
        }

        return steps.length > 0 ? steps : [{ title: 'Browse Repository', file: 'Explore the files in the tree tab' }];
    }

    async function updateRateLimitDisplay() {
        try {
            const headers = await getAuthHeaders(); // ADD THIS LINE
            const response = await fetch(`${GITHUB_API}/rate_limit`, { headers }); // ADD { headers }
            const data = await response.json();
            const display = document.getElementById('rate-limit-status');

            if (display) {
                const remaining = data.rate.remaining;
                const limit = data.rate.limit; // ADD THIS LINE
                const resetTime = new Date(data.rate.reset * 1000).toLocaleTimeString();

                if (remaining < CONFIG.API_RATE_LIMIT_WARNING) {
                    display.style.color = '#da3633';
                    display.textContent = `${remaining}/${limit} API requests left (resets at ${resetTime})`; // CHANGE THIS
                } else {
                    display.style.color = '#8b949e';
                    display.textContent = `${remaining}/${limit} API requests remaining`; // CHANGE THIS
                }
            }
        } catch (e) {
            console.warn('Could not update rate limit display');
        }
    }


    async function renderSidebar(sidebar, owner, repo, data) {
        const mainContent = sidebar.querySelector('#sidebar-main-content');
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
    
        // Initial update
        updateRateLimitDisplay();
    
        if (rateLimitInterval) {
            clearInterval(rateLimitInterval);
            rateLimitInterval = null;
        }
    
        const headers = await getAuthHeaders();
        const rateLimitRes = await fetch(`${GITHUB_API}/rate_limit`, { headers }).catch(() => null);
        if (rateLimitRes && rateLimitRes.ok) {
            const rateData = await rateLimitRes.json();
            if (rateData.rate.remaining > 0) {
                rateLimitInterval = setInterval(updateRateLimitDisplay, 560000);
            }
        }
    }  

    function setupEventHandlers(container, owner, repo, data) {
        const treeContainer = container.querySelector('#file-tree-container');
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
        setupLargeFilesToggle(container);
        setupTimeTravelFeatures(container, owner, repo);
        setupExpandableList(container, 'bundle-files');
        setupExpandableList(container, 'secrets');
        setupExpandableList(container, 'security-issues');
        
        // Re-add bookmark icons when switching tabs
        setupTabSwitching(container.closest('#codebase-navigator-sidebar'), owner, repo);
    }

    function setupTimeTravelFeatures(container, owner, repo) {
        const deletedBtn = container.querySelector('#view-deleted-files-btn');
        const deletedContainer = container.querySelector('#deleted-files-container');

        if (deletedBtn && deletedContainer) {
            deletedBtn.addEventListener('click', async () => {
                if (deletedContainer.style.display === 'none') {
                    deletedBtn.textContent = 'Loading deleted files...';
                    deletedBtn.disabled = true;

                    const deleted = await detectDeletedFiles(owner, repo);

                    if (deleted.length === 0) {
                        deletedContainer.innerHTML = `
                            <div style="text-align: center; color: #8b949e; font-size: 12px; padding: 20px;">
                                No deleted files found in recent history
                            </div>
                        `;
                    } else {
                        deletedContainer.innerHTML = `
                            <div style="font-size: 11px; color: #8b949e; margin-bottom: 8px;">
                                Found ${deleted.length} deleted file(s) in recent history
                            </div>
                            ${deleted.map(file => `
                                <div style="background: rgba(218, 54, 51, 0.1); border: 1px solid rgba(218, 54, 51, 0.3); border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                                    <div style="font-size: 12px; color: #da3633; font-family: monospace; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        ${file.path}
                                    </div>
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 4px;">
                                        Deleted by ${file.deletedBy} on ${new Date(file.deletedAt).toLocaleDateString()}
                                    </div>
                                    <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                        ${file.commitMessage}
                                    </div>
                                    <a href="${file.commitUrl}" target="_blank" style="font-size: 11px; color: #58a6ff; text-decoration: none;">
                                        View commit
                                    </a>
                                </div>
                            `).join('')}
                        `;
                    }

                    deletedContainer.style.display = 'block';
                    deletedBtn.textContent = 'Hide Deleted Files';
                    deletedBtn.disabled = false;
                } else {
                    deletedContainer.style.display = 'none';
                    deletedBtn.textContent = 'View Deleted Files (Ghost Mode)';
                }
            });
        }
    }

    // Individual tab renderers
    function renderOverviewTab(data, steps) {
        return `
            <div class="tab-content active" id="tab-overview">
                ${renderOnboardingSteps(steps)}
                ${renderRepoStats(data.stats)}
                ${data.info.description ? renderDescription(data.info.description) : ''}
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
                    ${steps.map(step => `
                        <li class="onboarding-step">
                            <div class="step-title">${step.title}</div>
                            ${step.file ? `<div class="step-file">${step.file}</div>` : ''}
                            ${step.command ? `<div class="step-command">${step.command}</div>` : ''}
                        </li>
                    `).join('')}
                </ol>
            </div>
        `;
    }

    function renderRepoStats(stats) {
        const statItems = [
            { label: 'Language', value: stats.language || 'Unknown' },
            { label: 'Stars', value: stats.stars.toLocaleString() },
            { label: 'Forks', value: stats.forks.toLocaleString() },
            { label: 'Open Issues', value: stats.openIssues.toLocaleString() },
            { label: 'Total Files', value: stats.totalFiles.toLocaleString() },
            { label: 'Repository Size', value: formatBytes(stats.totalSize) }
        ];

        return `
            <div class="section">
                <h3 class="section-title">Repository Stats</h3>
                <div class="stat-box">
                    ${statItems.map(item => `
                        <div class="stat-row">
                            <span class="stat-label">${item.label}</span>
                            <span class="stat-value">${item.value}</span>
                        </div>
                    `).join('')}
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
                    ${visibleFiles.map(file => renderFileItem(file)).join('')}
                    
                    ${hiddenFiles.length > 0 ? `
                        <div id="key-files-hidden" style="display: none;">
                            ${hiddenFiles.map(file => renderFileItem(file)).join('')}
                        </div>
                        <button class="btn-secondary" id="toggle-key-files" style="width: 100%; margin-top: 8px;">
                            Show More (${hiddenFiles.length} more)
                        </button>
                    ` : ''}
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
            if (files.length === 0) return '';
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
        }).join('')}
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
                    
                    <!-- Show button first, input hidden -->
                    <button class="btn-primary" id="activate-search-btn" style="margin-bottom: 16px;">
                        Click to Activate Search
                    </button>
                    
                    <div id="search-input-container" style="display: none; margin-bottom: 16px;">
                        <input
                            type="text"
                            class="search-input"
                            id="repo-file-query"
                            autocomplete="off"
                            placeholder="Type to search files...">
                    </div>
                    
                    <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
                        <button class="search-filter-btn active" data-filter="all">
                            All
                        </button>
                        <button class="search-filter-btn" data-filter="frontend">
                            Frontend
                        </button>
                        <button class="search-filter-btn" data-filter="backend">
                            Backend
                        </button>
                        <button class="search-filter-btn" data-filter="config">
                            Config
                        </button>
                        <button class="search-filter-btn" data-filter="tests">
                            Tests
                        </button>
                        <button class="search-filter-btn" data-filter="docs">
                            Docs
                        </button>
                    </div>
                    
                    <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                        <select class="search-input" id="file-type-filter" style="flex: 1;">
                            <option value="">All file types</option>
                        </select>
                        <select class="search-input" id="file-size-filter" style="flex: 1;">
                            <option value="">All sizes</option>
                            <option value="small">Small (&lt;10KB)</option>
                            <option value="medium">Medium (10-100KB)</option>
                            <option value="large">Large (&gt;100KB)</option>
                        </select>
                    </div>
                    
                    <div id="search-results"></div>
                </div>
            </div>
        `;
    }



    function renderInsightsTab(data) {
        const healthClass = getHealthClass(data.stats.healthScore);
        const healthMessage = getHealthMessage(data.stats.healthScore);
        const healthTips = getHealthTips(data);
        const codeQuality = calculateCodeQuality(data.files, data);
        const hotspots = analyzeFileHotspots(data.commits, data.files);
        const docGaps = analyzeDocumentationGaps(data.files, data);

        return `
            <div class="tab-content" id="tab-insights">
                <div class="section">
                    <h3 class="section-title">Repository Health Score</h3>
                    <div class="health-score ${healthClass}">${data.stats.healthScore}/100</div>
                    <div style="text-align: center; color: #8b949e; font-size: 13px; margin-bottom: 20px;">
                        ${healthMessage}
                    </div>
                    
                    ${healthTips.length > 0 ? `
                        <div style="background: rgba(88, 166, 255, 0.1); border: 1px solid rgba(88, 166, 255, 0.3); border-radius: 6px; padding: 12px; margin-top: 16px;">
                            <div style="font-size: 12px; font-weight: 600; color: #58a6ff; margin-bottom: 8px;">Quick Wins to Improve Health</div>
                            <div style="font-size: 11px; color: #8b949e; line-height: 1.8;">
                                ${healthTips.map(tip => `${tip}`).join('<br>')}
                            </div>
                        </div>
                    ` : ''}
                </div>
    
                ${renderCodeQualitySection(codeQuality)}
                ${renderDocumentationGapsSection(docGaps)}
                ${renderHotspotsSection(hotspots)}
                ${renderQuickInsights(data)}
                ${renderFileTypeDistribution(data.stats)}
                ${renderLargeFiles(data.stats.largFiles)}
                ${renderRecentCommits(data.commits)}
            </div>
        `;
    }

    function renderHotspotsSection(hotspots) {
        if (hotspots.length === 0) return '';

        return `
            <div class="section">
                <h3 class="section-title">File Hotspots</h3>
                <div style="font-size: 11px; color: #8b949e; margin-bottom: 12px;">
                    Files changed most frequently (may need refactoring)
                </div>
                ${hotspots.slice(0, 5).map(file => `
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: between; align-items: start;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 12px; color: #c9d1d9; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    ${file.path}
                                </div>
                                <div style="font-size: 10px; color: #8b949e; margin-top: 4px;">
                                    ${file.editCount} edits • ${formatBytes(file.size)}
                                </div>
                            </div>
                            <div style="margin-left: 12px;">
                                <div style="background: rgba(218, 54, 51, 0.2); padding: 4px 8px; border-radius: 4px; font-size: 10px; color: #da3633; font-weight: 600; white-space: nowrap;">
                                    HIGH CHURN
                                </div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }


    function getHealthTips(data) {
        const tips = [];

        // Check for large files
        if (data.stats.largFiles && data.stats.largFiles.length > 10) {
            tips.push('Split large files into smaller modules');
        } else if (data.stats.largFiles && data.stats.largFiles.length > 5) {
            tips.push('Consider refactoring some large files');
        }

        // Check for tests
        const hasTests = data.files.some(f =>
            f.path.includes('test') ||
            f.path.includes('spec') ||
            f.path.includes('__tests__')
        );
        if (!hasTests) {
            tips.push('Add test coverage to improve reliability');
        }

        // Check for README
        const hasReadme = data.files.some(f => f.path.toLowerCase() === 'readme.md');
        if (!hasReadme) {
            tips.push('Add a README.md with project documentation');
        }

        // Check for license
        const hasLicense = data.files.some(f => f.path.toLowerCase().includes('license'));
        if (!hasLicense) {
            tips.push('Add a LICENSE file for legal clarity');
        }

        // Check for too many files
        if (data.files.length > 1000) {
            tips.push('Consider archiving or removing unused files');
        }

        // Check for .gitignore
        const hasGitignore = data.files.some(f => f.path === '.gitignore');
        if (!hasGitignore) {
            tips.push('Add .gitignore to exclude unnecessary files');
        }

        return tips;
    }

    function getHealthClass(score) {
        if (score >= 80) return 'health-excellent';
        if (score >= 60) return 'health-good';
        if (score >= 40) return 'health-fair';
        return 'health-poor';
    }

    function getHealthMessage(score) {
        if (score >= 80) return 'Excellent repository health!';
        if (score >= 60) return 'Good repository health';
        if (score >= 40) return 'Fair repository health';
        return 'Needs improvement';
    }

    function renderQuickInsights(data) {
        const insights = [
            { value: data.stats.totalFiles.toLocaleString(), label: 'Total Files' },
            { value: data.stats.topExtensions.length, label: 'File Types' },
            { value: data.commits.length, label: 'Recent Commits' },
            { value: data.contributors.length, label: 'Contributors' }
        ];

        return `
            <div class="section">
                <h3 class="section-title">Quick Insights</h3>
                <div class="metric-grid">
                    ${insights.map(insight => `
                        <div class="insight-card">
                            <div class="insight-value">${insight.value}</div>
                            <div class="insight-label">${insight.label}</div>
                        </div>
                    `).join('')}
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
        }).join('')}
            </div>
        `;
    }

    function renderLargeFiles(largFiles) {
        if (!largFiles || largFiles.length === 0) return '';

        const visibleFiles = largFiles.slice(0, 3);
        const hiddenFiles = largFiles.slice(3);

        return `
        <div class="section">
            <h3 class="section-title">Large Files (>100KB)</h3>
            <div id="large-files-visible">
                ${visibleFiles.map(file => `
                    <div class="file-item" data-path="${file.path}">
                        <div class="file-name">${file.path.split('/').pop()}</div>
                        <div class="file-path">${file.path}</div>
                        <span class="file-type-badge">${formatBytes(file.size)}</span>
                    </div>
                `).join('')}
            </div>
            
            ${hiddenFiles.length > 0 ? `
                <div id="large-files-hidden" style="display: none;">
                    ${hiddenFiles.map(file => `
                        <div class="file-item" data-path="${file.path}">
                            <div class="file-name">${file.path.split('/').pop()}</div>
                            <div class="file-path">${file.path}</div>
                            <span class="file-type-badge">${formatBytes(file.size)}</span>
                        </div>
                    `).join('')}
                </div>
                
                <button class="btn-secondary" id="toggle-large-files" style="width: 100%; margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                    <span>Show ${hiddenFiles.length} More</span>
                    <span style="transition: transform 0.2s;">▼</span>
                </button>
            ` : ''}
        </div>
    `;
    }

    function renderRecentCommits(commits) {
        if (!commits || commits.length === 0) return '';

        return `
            <div class="section">
                <h3 class="section-title">Recent Commits</h3>
                ${commits.slice(0, 5).map(commit => `
                    <div class="commit-item">
                        <div class="commit-message">${commit.commit.message.split('\n')[0]}</div>
                        <div class="commit-meta">
                            ${commit.commit.author.name} - ${new Date(commit.commit.author.date).toLocaleDateString()}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderCodeQualitySection(codeQuality) {
        const { scores, issues } = codeQuality;

        function getScoreColor(score) {
            if (score >= 80) return '#3fb950';
            if (score >= 60) return '#58a6ff';
            if (score >= 40) return '#d29922';
            return '#da3633';
        }

        function getScoreLabel(score) {
            if (score >= 80) return 'Excellent';
            if (score >= 60) return 'Good';
            if (score >= 40) return 'Fair';
            return 'Needs Work';
        }

        return `
            <div class="section">
                <h3 class="section-title">Code Quality Analysis</h3>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px;">
                    ${Object.entries(scores).filter(([key]) => key !== 'overall').map(([key, score]) => `
                        <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                            <div style="font-size: 11px; color: #8b949e; text-transform: capitalize; margin-bottom: 6px;">
                                ${key}
                            </div>
                            <div style="display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px;">
                                <div style="font-size: 24px; font-weight: 700; color: ${getScoreColor(score)};">
                                    ${score}
                                </div>
                                <div style="font-size: 11px; color: #8b949e;">/100</div>
                            </div>
                            <div style="font-size: 10px; color: ${getScoreColor(score)};">
                                ${getScoreLabel(score)}
                            </div>
                        </div>
                    `).join('')}
                </div>
    
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; color: #8b949e; margin-bottom: 8px;">Overall Quality Score</div>
                    <div style="font-size: 48px; font-weight: 700; color: ${getScoreColor(scores.overall)}; line-height: 1;">
                        ${scores.overall}
                    </div>
                    <div style="font-size: 14px; color: ${getScoreColor(scores.overall)}; margin-top: 4px;">
                        ${getScoreLabel(scores.overall)}
                    </div>
                </div>
    
                ${Object.entries(issues).some(([_, list]) => list.length > 0) ? `
                    <div style="background: rgba(218, 54, 51, 0.1); border: 1px solid rgba(218, 54, 51, 0.3); border-radius: 6px; padding: 12px;">
                        <div style="font-size: 12px; font-weight: 600; color: #da3633; margin-bottom: 10px;">
                            Issues Found
                        </div>
                        ${Object.entries(issues).map(([category, issueList]) => {
            if (issueList.length === 0) return '';
            return `
                                <div style="margin-bottom: 8px;">
                                    <div style="font-size: 11px; font-weight: 600; color: #c9d1d9; text-transform: capitalize; margin-bottom: 4px;">
                                        ${category}
                                    </div>
                                    ${issueList.map(issue => `
                                        <div style="font-size: 11px; color: #8b949e; margin-left: 12px; margin-bottom: 2px;">
                                            • ${issue}
                                        </div>
                                    `).join('')}
                                </div>
                            `;
        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderMetricsTab(data) {
        const performanceMetrics = calculatePerformanceMetrics(data.files, data.dependencies);
        const timeline = analyzeRepositoryGrowth(data.commits);
        
        return `
            <div class="tab-content" id="tab-metrics">
                ${renderCodeMetricsCards(data.metrics)}
                ${timeline && timeline.length > 0 ? renderTimelineSection(timeline) : ''}
                ${renderPerformanceSection(performanceMetrics)}
                ${renderComplexityScore(data.metrics)}
                ${renderCommitActivity(data.metrics)}
            </div>
        `;
    }

    function renderPerformanceSection(metrics) {
        return `
            <div class="section">
                <h3 class="section-title">Performance Analysis</h3>
                
                <div class="metric-grid">
                    <div class="insight-card">
                        <div class="insight-value">${formatBytes(metrics.bundleSize.total)}</div>
                        <div class="insight-label">Estimated Bundle Size</div>
                    </div>
                    <div class="insight-card">
                        <div class="insight-value">${metrics.bundleSize.largest.length}</div>
                        <div class="insight-label">Large Files</div>
                    </div>
                </div>
    
                ${metrics.bundleSize.largest.length > 0 ? `
                    <div style="margin-top: 16px;">
                        <div style="font-size: 13px; font-weight: 600; color: #c9d1d9; margin-bottom: 10px;">
                            Largest Bundle Contributors
                        </div>
                        <div id="visible-bundle-files">
                            ${metrics.bundleSize.largest.slice(0, 3).map(file => `
                                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                        <div style="font-size: 12px; color: #c9d1d9; font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                            ${file.path}
                                        </div>
                                        <div style="font-size: 12px; color: #d29922; font-weight: 600; margin-left: 12px;">
                                            ${formatBytes(file.size)}
                                        </div>
                                    </div>
                                    <div style="background: #0d1117; height: 6px; border-radius: 3px; overflow: hidden;">
                                        <div style="background: #d29922; height: 100%; width: ${file.percentage}%;"></div>
                                    </div>
                                    <div style="font-size: 10px; color: #8b949e; margin-top: 4px;">
                                        ${file.percentage}% of bundle
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        
                        ${metrics.bundleSize.largest.length > 3 ? `
                            <div id="hidden-bundle-files" style="display: none;">
                                ${metrics.bundleSize.largest.slice(3).map(file => `
                                    <div class="expandable-item" style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                            <div style="font-size: 12px; color: #c9d1d9; font-family: monospace; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                ${file.path}
                                            </div>
                                            <div style="font-size: 12px; color: #d29922; font-weight: 600; margin-left: 12px;">
                                                ${formatBytes(file.size)}
                                            </div>
                                        </div>
                                        <div style="background: #0d1117; height: 6px; border-radius: 3px; overflow: hidden;">
                                            <div style="background: #d29922; height: 100%; width: ${file.percentage}%;"></div>
                                        </div>
                                        <div style="font-size: 10px; color: #8b949e; margin-top: 4px;">
                                            ${file.percentage}% of bundle
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            
                            <button class="btn-secondary" id="toggle-bundle-files" style="width: 100%; margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                <span class="btn-text">Show ${metrics.bundleSize.largest.length - 3} More</span>
                                <span class="arrow-icon" style="transition: transform 0.2s;">▼</span>
                            </button>
                        ` : ''}
                    </div>
                ` : ''}
    
                ${metrics.heavyDeps.length > 0 ? `
                    <div style="margin-top: 16px;">
                        <div style="font-size: 13px; font-weight: 600; color: #c9d1d9; margin-bottom: 10px;">
                            Heavy Dependencies Detected
                        </div>
                        ${metrics.heavyDeps.map(dep => `
                            <div style="background: rgba(210, 153, 34, 0.1); border: 1px solid rgba(210, 153, 34, 0.3); border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <div style="font-size: 12px; color: #c9d1d9; font-weight: 600; font-family: monospace;">
                                            ${dep.name}
                                        </div>
                                        <div style="font-size: 11px; color: #8b949e; margin-top: 2px;">
                                            Consider: ${dep.alternative}
                                        </div>
                                    </div>
                                    <div style="font-size: 11px; color: #d29922; font-weight: 600;">
                                        ${dep.size}
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
    
                ${metrics.unusedDeps.length > 0 ? `
                    <div style="margin-top: 16px;">
                        <div style="font-size: 13px; font-weight: 600; color: #c9d1d9; margin-bottom: 10px;">
                            Potentially Unused Dependencies
                        </div>
                        <div style="background: rgba(88, 166, 255, 0.1); border: 1px solid rgba(88, 166, 255, 0.3); border-radius: 6px; padding: 10px;">
                            <div style="font-size: 11px; color: #8b949e; line-height: 1.8;">
                                ${metrics.unusedDeps.map(dep => `${dep}`).join('<br>')}
                            </div>
                            <div style="font-size: 10px; color: #8b949e; margin-top: 8px; font-style: italic;">
                                Note: These may be indirect dependencies. Verify before removing.
                            </div>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }
    


    function renderCodeMetricsCards(metrics) {
        const metricItems = [
            { value: metrics.estimatedLines.toLocaleString(), label: 'Est. Lines of Code' },
            { value: metrics.codeFiles, label: 'Code Files' },
            { value: formatBytes(metrics.avgFileSize), label: 'Avg File Size' },
            { value: metrics.avgCommitsPerMonth, label: 'Commits/Month' }
        ];

        return `
            <div class="section">
                <h3 class="section-title">Code Metrics</h3>
                <div class="metric-grid">
                    ${metricItems.map(item => `
                        <div class="insight-card">
                            <div class="insight-value">${item.value}</div>
                            <div class="insight-label">${item.label}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function renderComplexityScore(metrics) {
        const complexityColor = metrics.complexity < 30 ? '#3fb950' :
            metrics.complexity < 60 ? '#d29922' : '#da3633';
        const complexityMessage = metrics.complexity < 30 ? 'Low complexity - easy to maintain' :
            metrics.complexity < 60 ? 'Moderate complexity' :
                'High complexity - may need refactoring';

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
                                    <div class="bar-fill" style="width: ${(count / maxCommits * 100)}%"></div>
                                </div>
                                <div class="bar-value">${count}</div>
                            </div>
                        `).join('')}
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
                    ${data.contributors.length > 0 ?
                data.contributors.slice(0, 10).map(contributor => `
                            <div class="contributor-item">
                                <img src="${contributor.avatar_url}" alt="${contributor.login}" class="contributor-avatar">
                                <div class="contributor-info">
                                    <div class="contributor-name">${contributor.login}</div>
                                    <div class="contributor-commits">${contributor.contributions} contributions</div>
                                </div>
                            </div>
                        `).join('')
                : '<div style="color: #8b949e; font-size: 13px; text-align: center; padding: 20px;">No contributor data available</div>'
            }
                </div>
            </div>
        `;
    }

    function renderDependenciesTab(data) {
        const hasDeps = Object.values(data.dependencies).some(arr => arr.length > 0);

        return `
            <div class="tab-content" id="tab-dependencies">
                <div class="section">
                    <h3 class="section-title">Project Dependencies</h3>
                    ${renderDependencySection('NPM Packages', data.dependencies.npm)}
                    ${renderDependencySection('Python Packages', data.dependencies.python)}
                    ${renderDependencySection('Flutter Packages', data.dependencies.flutter)}
                    ${renderDependencySection('Rust Crates', data.dependencies.rust)}
                    
                    ${!hasDeps ? `
                        <div style="color: #8b949e; font-size: 13px; text-align: center; padding: 20px;">
                            No dependencies detected
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function renderDependencySection(title, dependencies) {
        if (!dependencies || dependencies.length === 0) return '';

        return `
            <div style="margin-bottom: 20px;">
                <h4 style="color: #c9d1d9; font-size: 13px; font-weight: 600; margin-bottom: 10px;">
                    ${title} (${dependencies.length})
                </h4>
                <div class="dependency-list">
                    ${dependencies.map(dep => `
                        <div class="dependency-item">
                            <span class="dep-name">${dep.name}</span>
                            <span class="dep-version">${dep.version}</span>
                            ${dep.outdated ? '<span style="color: #d29922; font-size: 11px; margin-left: 8px;">Check version</span>' : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function detectSecretPatterns(files) {
        const secrets = [];
        const patterns = [
            { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/, severity: 'high' },
            { name: 'AWS Secret Key', regex: /aws_secret_access_key\s*=\s*["']?([A-Za-z0-9/+=]{40})["']?/i, severity: 'high' },
            { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9]{36}/, severity: 'high' },
            { name: 'Generic API Key', regex: /api[_-]?key\s*[=:]\s*["']?([A-Za-z0-9_\-]{20,})["']?/i, severity: 'high' },
            { name: 'Private Key', regex: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/, severity: 'high' },
            { name: 'JWT Token', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, severity: 'medium' },
            { name: 'Database URL', regex: /(mongodb|mysql|postgres|redis):\/\/[^\s]+:[^\s]+@[^\s]+/i, severity: 'high' },
            { name: 'Slack Token', regex: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24,}/, severity: 'high' },
            { name: 'Stripe Key', regex: /sk_live_[0-9a-zA-Z]{24}/, severity: 'high' },
            { name: 'Google API Key', regex: /AIza[0-9A-Za-z_-]{35}/, severity: 'high' },
            { name: 'Password in Code', regex: /(password|passwd|pwd)\s*[=:]\s*["']([^"'\s]{8,})["']/i, severity: 'medium' },
            { name: 'Twilio Key', regex: /SK[0-9a-fA-F]{32}/, severity: 'high' },
            { name: 'SendGrid Key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/, severity: 'high' }
        ];

        files.forEach(file => {
            if (file.path.includes('node_modules') || file.path.includes('.git')) return;

            const suspicious = ['.env', 'config', 'secret', 'credential', 'key', 'token', 'password'];
            const isSuspicious = suspicious.some(s => file.path.toLowerCase().includes(s));

            if (isSuspicious) {
                patterns.forEach(pattern => {
                    secrets.push({
                        file: file.path,
                        type: pattern.name,
                        severity: pattern.severity,
                        line: 'Multiple locations'
                    });
                });
            }
        });

        return secrets.slice(0, 15);
    }

    function analyzeVulnerabilities(dependencies, files) {
        const vulnerabilities = [];

        const knownVulnerable = {
            'lodash': { versions: ['<4.17.21'], cve: 'CVE-2021-23337', description: 'Command injection' },
            'axios': { versions: ['<0.21.3'], cve: 'CVE-2021-3749', description: 'Server-side request forgery' },
            'moment': { versions: ['<2.29.4'], cve: 'CVE-2022-31129', description: 'Path traversal' },
            'express': { versions: ['<4.17.3'], cve: 'CVE-2022-24999', description: 'Open redirect' },
            'minimist': { versions: ['<1.2.6'], cve: 'CVE-2021-44906', description: 'Prototype pollution' },
            'node-fetch': { versions: ['<2.6.7'], cve: 'CVE-2022-0235', description: 'Exposure of sensitive information' },
            'trim': { versions: ['<0.0.3'], cve: 'CVE-2020-7753', description: 'Regular expression denial of service' },
            'ua-parser-js': { versions: ['<0.7.33'], cve: 'CVE-2022-25927', description: 'Malicious package' },
            'path-parse': { versions: ['<1.0.7'], cve: 'CVE-2021-23343', description: 'Regular expression denial of service' },
            'ansi-regex': { versions: ['<5.0.1'], cve: 'CVE-2021-3807', description: 'Regular expression denial of service' }
        };

        const allDeps = [
            ...dependencies.npm,
            ...dependencies.python,
            ...dependencies.flutter,
            ...dependencies.rust
        ];

        allDeps.forEach(dep => {
            if (knownVulnerable[dep.name]) {
                const vuln = knownVulnerable[dep.name];
                vulnerabilities.push({
                    package: dep.name,
                    version: dep.version,
                    cve: vuln.cve,
                    description: vuln.description,
                    severity: 'high'
                });
            }
        });

        return vulnerabilities;
    }

    function checkInsecurePractices(files) {
        const issues = [];

        const hasHttpsCheck = files.some(f =>
            f.path.match(/\.(js|jsx|ts|tsx|py)$/i) &&
            f.path.toLowerCase().includes('http')
        );

        const hasCors = files.some(f =>
            f.path.toLowerCase().includes('cors') ||
            f.path.toLowerCase().includes('middleware')
        );

        if (hasHttpsCheck) {
            issues.push({
                type: 'HTTP Usage',
                description: 'Files contain HTTP references, ensure HTTPS is enforced',
                severity: 'medium'
            });
        }

        const hasAuth = files.some(f =>
            f.path.toLowerCase().includes('auth') ||
            f.path.toLowerCase().includes('login')
        );

        const hasSession = files.some(f =>
            f.path.toLowerCase().includes('session') ||
            f.path.toLowerCase().includes('jwt')
        );

        if (hasAuth && !hasSession) {
            issues.push({
                type: 'Authentication',
                description: 'Authentication files found but no session management detected',
                severity: 'medium'
            });
        }

        const hasUpload = files.some(f =>
            f.path.toLowerCase().includes('upload') ||
            f.path.toLowerCase().includes('file')
        );

        if (hasUpload) {
            issues.push({
                type: 'File Upload',
                description: 'File upload functionality detected, ensure proper validation',
                severity: 'medium'
            });
        }

        return issues;
    }

    function renderSecurityRecommendations() {
        return `
            <div class="section">
                <h3 class="section-title">Security Best Practices</h3>
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                    <div style="color: #8b949e; font-size: 12px; line-height: 1.8;">
                        <div style="padding: 8px 0; border-bottom: 1px solid #30363d;">
                            <strong style="color: #c9d1d9;">Dependency Management</strong><br>
                            Run npm audit or equivalent regularly<br>
                            Keep dependencies up to date<br>
                            Use lock files for reproducible builds
                        </div>
                        <div style="padding: 8px 0; border-bottom: 1px solid #30363d;">
                            <strong style="color: #c9d1d9;">Secret Management</strong><br>
                            Never commit credentials to git<br>
                            Use environment variables<br>
                            Implement secret rotation policies
                        </div>
                        <div style="padding: 8px 0;">
                            <strong style="color: #c9d1d9;">Code Security</strong><br>
                            Enable branch protection rules<br>
                            Require code reviews<br>
                            Use static analysis tools
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // REPLACE renderSecurityTab function with this updated version

function renderSecurityTab(data) {
    const secrets = detectSecretPatterns(data.files);
    const vulnerabilities = analyzeVulnerabilities(data.dependencies, data.files);
    const insecurePractices = checkInsecurePractices(data.files);
    const allIssues = [...data.security, ...insecurePractices];

    return `
        <div class="tab-content" id="tab-security">
            <div class="section">
                <h3 class="section-title">Security Overview</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
                    <div class="insight-card">
                        <div class="insight-value" style="color: ${secrets.length > 0 ? '#da3633' : '#3fb950'};">
                            ${secrets.length}
                        </div>
                        <div class="insight-label">Potential Secrets</div>
                    </div>
                    <div class="insight-card">
                        <div class="insight-value" style="color: ${vulnerabilities.length > 0 ? '#da3633' : '#3fb950'};">
                            ${vulnerabilities.length}
                        </div>
                        <div class="insight-label">Known Vulnerabilities</div>
                    </div>
                </div>
            </div>

            ${secrets.length > 0 ? `
                <div class="section">
                    <h3 class="section-title">Exposed Secrets Detection</h3>
                    
                    <div id="visible-secrets">
                        ${secrets.slice(0, 3).map(secret => `
                            <div class="security-alert ${secret.severity}">
                                <div class="security-alert-title">
                                    ${secret.severity.toUpperCase()} - ${secret.type}
                                </div>
                                <div class="security-alert-desc">
                                    Found in: ${secret.file}
                                </div>
                                <div style="margin-top: 6px; font-size: 11px; color: #8b949e;">
                                    Location: ${secret.line}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    
                    ${secrets.length > 3 ? `
                        <div id="hidden-secrets" style="display: none;">
                            ${secrets.slice(3).map(secret => `
                                <div class="expandable-item security-alert ${secret.severity}">
                                    <div class="security-alert-title">
                                        ${secret.severity.toUpperCase()} - ${secret.type}
                                    </div>
                                    <div class="security-alert-desc">
                                        Found in: ${secret.file}
                                    </div>
                                    <div style="margin-top: 6px; font-size: 11px; color: #8b949e;">
                                        Location: ${secret.line}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <button class="btn-secondary" id="toggle-secrets" style="width: 100%; margin-top: 8px; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <span class="btn-text">Show ${secrets.length - 3} More</span>
                            <span class="arrow-icon" style="transition: transform 0.2s;">▼</span>
                        </button>
                    ` : ''}
                    
                    <div style="background: rgba(218, 54, 51, 0.1); border: 1px solid rgba(218, 54, 51, 0.3); border-radius: 6px; padding: 10px; margin-top: 12px;">
                        <div style="font-size: 11px; color: #8b949e; line-height: 1.6;">
                            <strong style="color: #da3633;">Action Required:</strong><br>
                            Rotate all exposed credentials immediately<br>
                            Add files to .gitignore<br>
                            Use environment variables or secret managers<br>
                            Review git history for leaked secrets
                        </div>
                    </div>
                </div>
            ` : ''}

            ${vulnerabilities.length > 0 ? `
                <div class="section">
                    <h3 class="section-title">Dependency Vulnerabilities</h3>
                    ${vulnerabilities.map(vuln => `
                        <div class="security-alert high">
                            <div class="security-alert-title">
                                ${vuln.cve} - ${vuln.package}
                            </div>
                            <div class="security-alert-desc">
                                ${vuln.description}
                            </div>
                            <div style="margin-top: 6px; display: flex; justify-content: space-between; align-items: center;">
                                <div style="font-size: 11px; color: #8b949e;">
                                    Current version: ${vuln.version}
                                </div>
                                <a href="https://nvd.nist.gov/vuln/detail/${vuln.cve}" 
                                   target="_blank" 
                                   style="font-size: 11px; color: #58a6ff; text-decoration: none;">
                                    View Details
                                </a>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            ${allIssues.length > 0 ? `
                <div class="section">
                    <h3 class="section-title">Security Issues</h3>
                    
                    <div id="visible-security-issues">
                        ${allIssues.slice(0, 3).map(issue => `
                            <div class="security-alert ${issue.severity}">
                                <div class="security-alert-title">
                                    ${issue.severity.toUpperCase()} - ${issue.title || issue.type}
                                </div>
                                <div class="security-alert-desc">${issue.description}</div>
                                ${issue.files ? `
                                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #30363d;">
                                        ${issue.files.map(file => `
                                            <div style="color: #8b949e; font-size: 11px; font-family: monospace; margin-top: 4px;">
                                                ${file}
                                            </div>
                                        `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                    
                    ${allIssues.length > 3 ? `
                        <div id="hidden-security-issues" style="display: none;">
                            ${allIssues.slice(3).map(issue => `
                                <div class="expandable-item security-alert ${issue.severity}">
                                    <div class="security-alert-title">
                                        ${issue.severity.toUpperCase()} - ${issue.title || issue.type}
                                    </div>
                                    <div class="security-alert-desc">${issue.description}</div>
                                    ${issue.files ? `
                                        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #30363d;">
                                            ${issue.files.map(file => `
                                                <div style="color: #8b949e; font-size: 11px; font-family: monospace; margin-top: 4px;">
                                                    ${file}
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>
                        
                        <button class="btn-secondary" id="toggle-security-issues" style="width: 100%; margin-top: 8px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <span class="btn-text">Show ${allIssues.length - 3} More</span>
                            <span class="arrow-icon" style="transition: transform 0.2s;">▼</span>
                        </button>
                    ` : ''}
                </div>
            ` : ''}

            ${secrets.length === 0 && vulnerabilities.length === 0 && allIssues.length === 0 ? `
                <div class="section">
                    <div style="background: rgba(63, 185, 80, 0.1); border: 1px solid #3fb950; border-radius: 6px; padding: 20px; text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 12px;">✓</div>
                        <div style="color: #3fb950; font-size: 16px; font-weight: 600; margin-bottom: 8px;">
                            No Critical Issues Detected
                        </div>
                        <div style="color: #8b949e; font-size: 12px;">
                            Your repository follows basic security best practices
                        </div>
                    </div>
                </div>
            ` : ''}

            ${renderSecurityChecklist(data.files)}
            ${renderSecurityRecommendations()}
        </div>
    `;
}

    function renderSecurityChecklist(files) {
        const checks = [
            { label: '.gitignore file present', passed: files.some(f => f.path === '.gitignore') },
            { label: 'License file present', passed: files.some(f => f.path.toLowerCase().includes('license')) },
            { label: 'No .env files in repo', passed: !files.some(f => f.path === '.env' || f.path === '.env.local') },
            {
                label: 'Lock file for dependencies', passed: files.some(f =>
                    f.path === 'package-lock.json' || f.path === 'yarn.lock' || f.path === 'Cargo.lock'
                )
            }
        ];

        return `
            <div class="section">
                <h3 class="section-title">Security Checklist</h3>
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                    ${checks.map((check, index) => `
                        <div style="display: flex; align-items: center; padding: 8px 0; ${index < checks.length - 1 ? 'border-bottom: 1px solid #30363d;' : ''}">
                            <span style="font-size: 16px; margin-right: 12px;">${check.passed ? '✓' : '✗'}</span>
                            <span style="color: #c9d1d9; font-size: 13px;">${check.label}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    function analyzeDocumentationGaps(files, data) {
        const gaps = {
            missingReadme: false,
            shortReadme: false,
            noContributing: false,
            noChangelog: false,
            noLicense: false,
            noApiDocs: false,
            undocumentedFiles: [],
            totalFiles: 0,
            documentedFiles: 0,
            score: 100
        };

        const readme = files.find(f => f.path.toLowerCase() === 'readme.md');
        const contributing = files.find(f => f.path.toLowerCase() === 'contributing.md');
        const changelog = files.find(f => f.path.toLowerCase() === 'changelog.md');
        const license = files.find(f => f.path.toLowerCase().includes('license'));

        if (!readme) {
            gaps.missingReadme = true;
            gaps.score -= 30;
        } else if (readme.size < 1000) {
            gaps.shortReadme = true;
            gaps.score -= 15;
        }

        if (!contributing) {
            gaps.noContributing = true;
            gaps.score -= 10;
        }

        if (!changelog) {
            gaps.noChangelog = true;
            gaps.score -= 10;
        }

        if (!license) {
            gaps.noLicense = true;
            gaps.score -= 15;
        }

        const codeFiles = files.filter(f =>
            f.path.match(/\.(js|jsx|ts|tsx|py|dart|rs|go|java)$/i) &&
            !f.path.includes('test') &&
            !f.path.includes('spec') &&
            !f.path.includes('node_modules')
        );

        const apiFiles = codeFiles.filter(f =>
            f.path.includes('api') ||
            f.path.includes('controller') ||
            f.path.includes('route')
        );

        if (apiFiles.length > 0) {
            const apiDocs = files.filter(f =>
                f.path.includes('swagger') ||
                f.path.includes('openapi') ||
                f.path.toLowerCase().includes('api.md')
            );

            if (apiDocs.length === 0) {
                gaps.noApiDocs = true;
                gaps.score -= 20;
            }
        }

        const publicFolders = ['src', 'lib', 'app', 'api'];
        const publicFiles = codeFiles.filter(f =>
            publicFolders.some(folder => f.path.startsWith(folder + '/'))
        );

        gaps.totalFiles = publicFiles.length;

        publicFiles.forEach(file => {
            const hasDoc = files.some(docFile => {
                const baseName = file.path.replace(/\.[^.]+$/, '');
                return docFile.path.startsWith(baseName) &&
                    docFile.path.match(/\.(md|txt|rst)$/i);
            });

            if (!hasDoc) {
                gaps.undocumentedFiles.push(file.path);
            } else {
                gaps.documentedFiles++;
            }
        });

        if (gaps.totalFiles > 0) {
            const docRatio = gaps.documentedFiles / gaps.totalFiles;
            if (docRatio < 0.3) {
                gaps.score -= 20;
            } else if (docRatio < 0.6) {
                gaps.score -= 10;
            }
        }

        gaps.score = Math.max(0, gaps.score);
        return gaps;
    }

    function generateMermaidDiagram(data) {
        const categories = data.categorized;
        let diagram = 'graph TD\n';

        diagram += '    Root[Repository]\n';

        if (categories.frontend.length > 0) {
            diagram += '    Root --> Frontend[Frontend]\n';
            const topFrontend = categories.frontend.slice(0, 3);
            topFrontend.forEach((file, idx) => {
                const name = file.path.split('/').pop().replace(/\./g, '_');
                diagram += `    Frontend --> F${idx}[${name}]\n`;
            });
        }

        if (categories.backend.length > 0) {
            diagram += '    Root --> Backend[Backend]\n';
            const topBackend = categories.backend.slice(0, 3);
            topBackend.forEach((file, idx) => {
                const name = file.path.split('/').pop().replace(/\./g, '_');
                diagram += `    Backend --> B${idx}[${name}]\n`;
            });
        }

        if (categories.config.length > 0) {
            diagram += '    Root --> Config[Configuration]\n';
            const topConfig = categories.config.slice(0, 3);
            topConfig.forEach((file, idx) => {
                const name = file.path.split('/').pop().replace(/\./g, '_');
                diagram += `    Config --> C${idx}[${name}]\n`;
            });
        }

        if (categories.tests.length > 0) {
            diagram += '    Root --> Tests[Tests]\n';
        }

        if (categories.docs.length > 0) {
            diagram += '    Root --> Docs[Documentation]\n';
        }

        diagram += '\n    classDef frontend fill:#61dafb\n';
        diagram += '    classDef backend fill:#3fb950\n';
        diagram += '    classDef config fill:#d29922\n';
        diagram += '    class Frontend frontend\n';
        diagram += '    class Backend backend\n';
        diagram += '    class Config config\n';

        return diagram;
    }

    function generateDetailedMermaid(data) {
        let diagram = 'graph LR\n';

        const folders = {};
        data.files.forEach(file => {
            const parts = file.path.split('/');
            if (parts.length > 1) {
                const folder = parts[0];
                if (!folders[folder]) folders[folder] = [];
                folders[folder].push(file);
            }
        });

        Object.entries(folders).slice(0, 5).forEach(([folder, files]) => {
            const safeFolder = folder.replace(/[^a-zA-Z0-9]/g, '_');
            diagram += `    ${safeFolder}[${folder}]\n`;

            files.slice(0, 3).forEach((file, idx) => {
                const fileName = file.path.split('/').pop();
                const safeName = fileName.replace(/[^a-zA-Z0-9]/g, '_');
                diagram += `    ${safeFolder} --> ${safeFolder}_${idx}[${fileName}]\n`;
            });
        });

        return diagram;
    }

    function renderDocumentationGapsSection(gaps) {
        return `
            <div class="section">
                <h3 class="section-title">Documentation Analysis</h3>
                
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; text-align: center; margin-bottom: 16px;">
                    <div style="font-size: 12px; color: #8b949e; margin-bottom: 8px;">Documentation Score</div>
                    <div style="font-size: 48px; font-weight: 700; color: ${gaps.score >= 80 ? '#3fb950' : gaps.score >= 60 ? '#58a6ff' : gaps.score >= 40 ? '#d29922' : '#da3633'}; line-height: 1;">
                        ${gaps.score}
                    </div>
                    <div style="font-size: 14px; color: #8b949e; margin-top: 4px;">
                        ${gaps.score >= 80 ? 'Excellent' : gaps.score >= 60 ? 'Good' : gaps.score >= 40 ? 'Fair' : 'Needs Work'}
                    </div>
                </div>
    
                ${gaps.missingReadme || gaps.shortReadme || gaps.noContributing || gaps.noChangelog || gaps.noLicense || gaps.noApiDocs ? `
                    <div style="background: rgba(210, 153, 34, 0.1); border: 1px solid rgba(210, 153, 34, 0.3); border-radius: 6px; padding: 12px; margin-bottom: 12px;">
                        <div style="font-size: 12px; font-weight: 600; color: #d29922; margin-bottom: 10px;">
                            Missing Documentation
                        </div>
                        <div style="font-size: 11px; color: #8b949e; line-height: 1.8;">
                            ${gaps.missingReadme ? 'Add README.md to describe the project<br>' : ''}
                            ${gaps.shortReadme ? 'Expand README.md with more details<br>' : ''}
                            ${gaps.noContributing ? 'Add CONTRIBUTING.md for contributor guidelines<br>' : ''}
                            ${gaps.noChangelog ? 'Add CHANGELOG.md to track changes<br>' : ''}
                            ${gaps.noLicense ? 'Add LICENSE file for legal clarity<br>' : ''}
                            ${gaps.noApiDocs ? 'Add API documentation (Swagger/OpenAPI)' : ''}
                        </div>
                    </div>
                ` : ''}
    
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                        <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px;">Total Files</div>
                        <div style="font-size: 24px; font-weight: 700; color: #c9d1d9;">${gaps.totalFiles}</div>
                    </div>
                    <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 12px;">
                        <div style="font-size: 11px; color: #8b949e; margin-bottom: 6px;">Documented</div>
                        <div style="font-size: 24px; font-weight: 700; color: #3fb950;">${gaps.documentedFiles}</div>
                    </div>
                </div>
    
                ${gaps.undocumentedFiles.length > 0 ? `
                    <div style="margin-top: 12px;">
                        <div style="font-size: 12px; font-weight: 600; color: #c9d1d9; margin-bottom: 8px;">
                            Files Needing Documentation (showing ${Math.min(5, gaps.undocumentedFiles.length)} of ${gaps.undocumentedFiles.length})
                        </div>
                        ${gaps.undocumentedFiles.slice(0, 5).map(file => `
                            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 4px; padding: 8px; margin-bottom: 6px;">
                                <div style="font-size: 11px; color: #8b949e; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    ${file}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function renderTechStackTab(data) {
        const hasStack = Object.values(data.techStack).some(arr => arr.length > 0);

        return `
            <div class="tab-content" id="tab-tech">
                <div class="section">
                    <h3 class="section-title">Technology Stack</h3>
                    ${renderTechCategory('Frontend', data.techStack.frontend)}
                    ${renderTechCategory('Backend', data.techStack.backend)}
                    ${renderTechCategory('Database', data.techStack.database)}
                    ${renderTechCategory('DevOps & Build', data.techStack.devops)}
                    ${renderTechCategory('Mobile', data.techStack.mobile)}
                    ${renderTechCategory('Testing', data.techStack.testing)}
                    
                    ${!hasStack ? `
                        <div style="color: #8b949e; font-size: 13px; text-align: center; padding: 20px;">
                            Technology stack could not be detected automatically
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function renderTechCategory(title, technologies) {
        if (!technologies || technologies.length === 0) return '';

        return `
            <div style="margin-bottom: 20px;">
                <h4 style="color: #c9d1d9; font-size: 13px; font-weight: 600; margin-bottom: 10px;">${title}</h4>
                <div style="display: flex; flex-wrap: wrap;">
                    ${technologies.map(tech => `
                        <div class="tech-badge">
                            <span>${tech.name}</span>
                        </div>
                    `).join('')}
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
                    <img src="${chrome.runtime.getURL('icons/logo64light.png')}" 
                         alt="GitNav Logo" 
                         style="width: 64px; height: 64px; border-radius: 12px; margin-bottom: 12px;" />
                    <h2 style="font-size: 24px; font-weight: 700; color: #c9d1d9; margin: 0 0 8px 0;">GitNav</h2>
                    <div style="color: #8b949e; font-size: 13px; margin-bottom: 20px;">Version 2.0.0</div>
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
                        • GitHub tokens stored locally on your device<br>
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
                        <button class="copy-btn" data-copy="git clone https://github.com/${owner}/${repo}.git">Copy</button>
                    </div>
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
                    <button class="btn-secondary export-btn" id="export-json-btn">Export JSON</button>
                    <button class="btn-secondary export-btn" id="export-md-btn">Export Markdown</button>
                </div>
                <div style="margin-top: 12px;">
                    <div style="font-size: 12px; font-weight: 600; color: #c9d1d9; margin-bottom: 8px;">
                        Mermaid Diagrams
                    </div>
                    <div class="export-options">
                        <button class="btn-secondary export-btn" id="export-mermaid-btn">Basic Diagram</button>
                        <button class="btn-secondary export-btn" id="export-mermaid-detailed-btn">Detailed Diagram</button>
                    </div>
                    <div style="font-size: 10px; color: #8b949e; margin-top: 6px; line-height: 1.5;">
                        Mermaid files can be viewed in GitHub, VSCode, or at mermaid.live
                    </div>
                </div>
            </div>
        `;
    }


    function initForceGraphVisualization(containerId, files, owner, repo) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const canvas = container.querySelector('canvas');
        const tooltip = container.querySelector('.viz-tooltip');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = 468;
        const height = 600;

        const PHYSICS = {
            centerForce: 0.002,
            collisionForce: 0.8,
            linkForce: 0.08,
            repulsionForce: 800,
            damping: 0.85,
            alpha: 0.5,
            minDistance: 5,
            coolingFactor: 0.995
        };

        let temperature = 1.0;
        let scale = 1;
        let translateX = 0;
        let translateY = 0;
        let animationFrameId = null;
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let dragNode = null;
        let hoverNode = null;

        const nodes = [];
        const links = [];
        const folderMap = new Map();

        const root = {
            id: 'root',
            name: 'Repository',
            x: width / 2,
            y: height / 2,
            vx: 0, vy: 0,
            r: 28,
            color: '#58a6ff',
            type: 'root',
            fixed: false
        };
        nodes.push(root);
        folderMap.set('root', root);

        const validFiles = files.filter(f => f.size > 0).slice(0, CONFIG.MAX_FILES_IN_GRAPH);
        const folderFiles = new Map();

        validFiles.forEach(file => {
            const parts = file.path.split('/');
            const firstFolder = parts.length > 1 ? parts[0] : 'root';
            if (!folderFiles.has(firstFolder)) folderFiles.set(firstFolder, []);
            folderFiles.get(firstFolder).push(file);
        });

        const folderEntries = Array.from(folderFiles.entries()).filter(([name]) => name !== 'root');
        const folderRadius = 180;

        folderEntries.forEach(([folderName, folderFilesList], index) => {
            const angle = (index / folderEntries.length) * Math.PI * 2;

            const folder = {
                id: folderName,
                name: folderName,
                x: width / 2 + Math.cos(angle) * folderRadius,
                y: height / 2 + Math.sin(angle) * folderRadius,
                vx: 0, vy: 0,
                r: 18 + Math.min(folderFilesList.length / 5, 8),
                color: '#238636',
                type: 'folder',
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
            const parts = file.path.split('/');
            const fileName = parts.pop();
            const parentFolder = parts.length > 0 ? parts[0] : 'root';
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
                r: Math.min(4 + Math.sqrt(file.size / 15000), 10),
                color: getFileColor(file.path),
                type: 'file',
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
            const ext = path.split('.').pop().toLowerCase();
            const colors = {
                'js': '#f1e05a', 'jsx': '#61dafb', 'ts': '#3178c6', 'tsx': '#3178c6',
                'py': '#3572A5', 'dart': '#00B4AB', 'rs': '#dea584', 'go': '#00ADD8',
                'java': '#b07219', 'html': '#e34c26', 'css': '#563d7c', 'scss': '#c6538c',
                'json': '#292929', 'md': '#083fa1', 'yaml': '#cb171e', 'yml': '#cb171e'
            };
            return colors[ext] || '#8b949e';
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
                    const fx = (dx / dist) * force;
                    const fy = (dy / dist) * force;

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
                        const fx = (dx / dist) * force;
                        const fy = (dy / dist) * force;

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

            links.forEach(link => {
                const source = link.source;
                const target = link.target;

                if (source.fixed || target.fixed) return;

                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;

                let targetDist = 80;
                if (source.type === 'root') targetDist = 160;
                if (source.type === 'folder' && target.type === 'file') targetDist = 70;

                const force = (dist - targetDist) * PHYSICS.linkForce * link.strength;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                if (source !== dragNode) {
                    source.vx += fx;
                    source.vy += fy;
                }
                if (target !== dragNode) {
                    target.vx -= fx;
                    target.vy -= fy;
                }
            });

            nodes.forEach(node => {
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


        function draw() {
            const vizTab = document.querySelector('#tab-visualize');
            if (!vizTab || !vizTab.classList.contains('active')) {
                setTimeout(() => requestAnimationFrame(draw), 500);
                return;
            }
        
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, width, height);
            ctx.translate(translateX * scale, translateY * scale);
            ctx.scale(scale, scale);
        
            links.forEach(link => {
                const source = link.source;
                const target = link.target;
        
                const gradient = ctx.createLinearGradient(source.x, source.y, target.x, target.y);
                gradient.addColorStop(0, source.color + '40');
                gradient.addColorStop(1, target.color + '40');
        
                ctx.strokeStyle = gradient;
                ctx.lineWidth = 1.5 / scale;
                ctx.beginPath();
                ctx.moveTo(source.x, source.y);
                ctx.lineTo(target.x, target.y);
                ctx.stroke();
            });
        
            nodes.forEach(node => {
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
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2 / scale;
                    ctx.stroke();
                } else if (node.type === 'root' || node.type === 'folder') {
                    ctx.strokeStyle = '#00000040';
                    ctx.lineWidth = 1 / scale;
                    ctx.stroke();
                }
        
                ctx.shadowBlur = 0;
        
                if (node.r > 10 || node === hoverNode || node.type !== 'file') {
                    ctx.fillStyle = '#ffffff';
                    ctx.font = `${Math.max(9, node.r)}px -apple-system, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
        
                    const maxLength = node.type === 'file' ? 12 : 18;
                    const displayName = node.name.length > maxLength
                        ? node.name.substring(0, maxLength - 1) + '…'
                        : node.name;
        
                    const textWidth = ctx.measureText(displayName).width;
                    ctx.fillStyle = 'rgba(13, 17, 23, 0.9)';
                    ctx.fillRect(node.x - textWidth / 2 - 3, node.y + node.r + 3, textWidth + 6, 14);
        
                    ctx.fillStyle = '#ffffff';
                    ctx.fillText(displayName, node.x, node.y + node.r + 5);
                }
            });
        
            simulate();
            animationFrameId = requestAnimationFrame(draw);
        }
        

        function worldToScreen(x, y) {
            return {
                x: (x + translateX) * scale,
                y: (y + translateY) * scale
            };
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

            dragNode = nodes.find(n => Math.hypot(n.x - world.x, n.y - world.y) < n.r);

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
                canvas.style.cursor = 'grabbing';
            } else if (isDragging) {
                translateX += (mx - dragStartX) / scale;
                translateY += (my - dragStartY) / scale;
                dragStartX = mx;
                dragStartY = my;
                canvas.style.cursor = 'grabbing';
            } else {
                hoverNode = nodes.find(n => Math.hypot(n.x - world.x, n.y - world.y) < n.r);

                if (hoverNode) {
                    tooltip.style.display = 'block';
                    tooltip.style.left = (e.pageX + 10) + 'px';
                    tooltip.style.top = (e.pageY - 30) + 'px';

                    let html = `<div style="font-weight: 600; margin-bottom: 4px;">${hoverNode.name}</div>`;

                    if (hoverNode.type === 'file') {
                        html += `<div style="color: #8b949e; font-size: 10px;">${hoverNode.path}</div>`;
                        html += `<div style="color: #58a6ff; margin-top: 4px;">${Math.round(hoverNode.size / 1024)} KB</div>`;
                    } else if (hoverNode.type === 'folder') {
                        html += `<div style="color: #8b949e;">${hoverNode.fileCount} files</div>`;
                    } else if (hoverNode.type === 'root') {
                        html += `<div style="color: #8b949e;">${nodes.length - 1} items</div>`;
                    }

                    tooltip.innerHTML = html;
                    canvas.style.cursor = 'pointer';
                } else {
                    tooltip.style.display = 'none';
                    canvas.style.cursor = 'grab';
                }
            }
        };

        canvas.onmouseup = () => {
            dragNode = null;
            isDragging = false;
            canvas.style.cursor = 'grab';
        };

        canvas.onmouseleave = () => {
            dragNode = null;
            isDragging = false;
            tooltip.style.display = 'none';
        };

        canvas.onclick = (e) => {
            if (hoverNode && hoverNode.type === 'file') {
                window.open(`https://github.com/${owner}/${repo}/blob/${globalDefaultBranch}/${hoverNode.path}`, '_blank');
            } else if (hoverNode && (hoverNode.type === 'folder' || hoverNode.type === 'root')) {
                const targetScale = 1.5;
                scale = targetScale;
                translateX = width / 2 / scale - hoverNode.x;
                translateY = height / 2 / scale - hoverNode.y;
            }
        };

        draw();

        registerCleanup(() => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        });
    }


    function setupExpandableList(container, listId, visibleCount = 3) {
        const toggleBtn = container.querySelector(`#toggle-${listId}`);
        const hiddenSection = container.querySelector(`#hidden-${listId}`);
        
        if (!toggleBtn || !hiddenSection) return;
        
        let isExpanded = false;
        
        toggleBtn.addEventListener('click', () => {
            isExpanded = !isExpanded;
            
            const arrow = toggleBtn.querySelector('.arrow-icon');
            const text = toggleBtn.querySelector('.btn-text');
            
            if (isExpanded) {
                hiddenSection.style.display = 'block';
                text.textContent = 'Show Less';
                if (arrow) arrow.style.transform = 'rotate(180deg)';
            } else {
                hiddenSection.style.display = 'none';
                const hiddenCount = hiddenSection.querySelectorAll('.expandable-item').length;
                text.textContent = `Show ${hiddenCount} More`;
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
        });
    }




    function setupKeyFilesToggle(container) {
        const toggleBtn = container.querySelector('#toggle-key-files');
        const hiddenFiles = container.querySelector('#key-files-hidden');

        if (!toggleBtn || !hiddenFiles) return;

        let isExpanded = false;

        toggleBtn.addEventListener('click', () => {
            isExpanded = !isExpanded;

            if (isExpanded) {
                hiddenFiles.style.display = 'block';
                toggleBtn.textContent = 'Show Less';
            } else {
                hiddenFiles.style.display = 'none';
                const hiddenCount = hiddenFiles.querySelectorAll('.file-item').length;
                toggleBtn.textContent = `Show More (${hiddenCount} more)`;
            }
        });
    }

    function setupLargeFilesToggle(container) {
        const toggleBtn = container.querySelector('#toggle-large-files');
        const hiddenFiles = container.querySelector('#large-files-hidden');

        if (!toggleBtn || !hiddenFiles) return;

        let isExpanded = false;

        toggleBtn.addEventListener('click', () => {
            isExpanded = !isExpanded;

            const arrow = toggleBtn.querySelector('span:last-child');
            const text = toggleBtn.querySelector('span:first-child');

            if (isExpanded) {
                hiddenFiles.style.display = 'block';
                text.textContent = 'Show Less';
                arrow.style.transform = 'rotate(180deg)';
            } else {
                hiddenFiles.style.display = 'none';
                const hiddenCount = hiddenFiles.querySelectorAll('.file-item').length;
                text.textContent = `Show ${hiddenCount} More`;
                arrow.style.transform = 'rotate(0deg)';
            }
        });
    }

    function setupTabSwitching(sidebar, owner, repo) {
        sidebar.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                sidebar.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                sidebar.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const targetTab = sidebar.querySelector(`#tab-${tab.dataset.tab}`);
                if (targetTab) {
                    targetTab.classList.add('active');
                }
            });
        });
    }

    function setupFileClickHandlers(container, owner, repo) {
        container.querySelectorAll('[data-path]').forEach(el => {
            const path = el.getAttribute('data-path');
    
            el.addEventListener('click', async (e) => {
                // Don't open GitHub if clicking on buttons or links inside
                if (e.target.closest('button') || e.target.closest('a')) {
                    return;
                }
    
                // Check if related files already showing
                const existing = el.querySelector('.file-recommendations');
                if (existing) {
                    existing.remove();
                    return;
                }
    
                // If it's a simple click without showing related files, open on GitHub
                // Check if this is a tree-item (from tree tab) or regular file-item
                const isTreeItem = el.classList.contains('tree-item');
                const isFileItem = el.classList.contains('file-item');
    
                // For tree items, show related files
                // For file items in other tabs, also show related files
                if (isTreeItem || isFileItem) {
                    const related = findRelatedFilesByStructure(path, globalData.files);
    
                    const recsDiv = document.createElement('div');
                    recsDiv.className = 'file-recommendations';
                    recsDiv.style.cssText = `
                        margin-top: 12px;
                        padding: 12px;
                        background: rgba(88, 166, 255, 0.05);
                        border: 1px solid rgba(88, 166, 255, 0.2);
                        border-radius: 6px;
                        width: 100%;
                        box-sizing: border-box;
                        flex-basis: 100%;
                    `;
    
                    let content = '';
    
                    if (related.length > 0) {
                        content += `
                            <div style="font-size: 11px; font-weight: 600; color: #58a6ff; margin-bottom: 8px;">
                                Related Files
                            </div>
                            ${related.map(r => `
                                <div class="related-file-link" data-related-path="${r.file}" style="font-size: 11px; padding: 6px 0; cursor: pointer; color: #8b949e; display: flex; align-items: center; gap: 6px;">
                                    <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.file.split('/').pop()}</span>
                                    <span style="font-size: 10px; color: #484f58;">${r.type}</span>
                                </div>
                            `).join('')}
                        `;
                    }
    
                    content += `
                        <button class="btn-secondary open-github-btn" style="width: 100%; margin-top: 8px; font-size: 11px; padding: 6px;">
                            Open on GitHub
                        </button>
                        <button class="btn-secondary view-history-btn" style="width: 100%; margin-top: 8px; font-size: 11px; padding: 6px;">
                            View File History
                        </button>
                        <div class="history-container" style="display: none; margin-top: 8px;"></div>
                    `;
    
                    recsDiv.innerHTML = content;
                    el.appendChild(recsDiv);
    
                    // Setup open on GitHub button - FIXED: Use globalDefaultBranch
                    const openGithubBtn = recsDiv.querySelector('.open-github-btn');
                    openGithubBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.open(`https://github.com/${owner}/${repo}/blob/${globalDefaultBranch}/${path}`, '_blank');
                    });
    
                    // Setup related file clicks - FIXED: Use globalDefaultBranch
                    recsDiv.querySelectorAll('.related-file-link').forEach(link => {
                        link.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const relatedPath = link.dataset.relatedPath;
                            window.open(`https://github.com/${owner}/${repo}/blob/${globalDefaultBranch}/${relatedPath}`, '_blank');
                        });
                    });
    
                    // Setup history button
                    const historyBtn = recsDiv.querySelector('.view-history-btn');
                    const historyContainer = recsDiv.querySelector('.history-container');
    
                    historyBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
    
                        if (historyContainer.style.display === 'none') {
                            historyBtn.textContent = 'Loading...';
                            historyBtn.disabled = true;
    
                            const evolution = await analyzeFileEvolution(owner, repo, path);
    
                            if (evolution.length === 0) {
                                historyContainer.innerHTML = `
                                    <div style="font-size: 11px; color: #8b949e; text-align: center; padding: 8px;">
                                        No history available
                                    </div>
                                `;
                            } else {
                                historyContainer.innerHTML = `
                                    <div style="font-size: 11px; font-weight: 600; color: #c9d1d9; margin-bottom: 6px;">
                                        Recent Changes (${evolution.length})
                                    </div>
                                    ${evolution.slice(0, 5).map(commit => {
                                        return `
                                            <div class="commit-link" data-url="${commit.url}" style="background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 6px; margin-bottom: 4px; cursor: pointer;">
                                                <div style="font-size: 11px; color: #c9d1d9; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                                    ${commit.message}
                                                </div>
                                                <div style="font-size: 10px; color: #8b949e;">
                                                    ${commit.author} - ${new Date(commit.date).toLocaleDateString()}
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                `;
                                
                                // Setup commit clicks
                                historyContainer.querySelectorAll('.commit-link').forEach(commitLink => {
                                    commitLink.addEventListener('click', (e) => {
                                        e.stopPropagation();
                                        window.open(commitLink.dataset.url, '_blank');
                                    });
                                });
                            }
    
                            historyContainer.style.display = 'block';
                            historyBtn.textContent = 'Hide History';
                            historyBtn.disabled = false;
                        } else {
                            historyContainer.style.display = 'none';
                            historyBtn.textContent = 'View File History';
                        }
                    });
    
                    e.stopPropagation();
                }
            });
        });
    }

    function setupTreeToggleHandlers(container) {
        container.querySelectorAll('.tree-toggle').forEach(toggle => {
            if (toggle.textContent.trim() === '') return;

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const treeItem = toggle.closest('.tree-item');
                const children = treeItem.nextElementSibling;

                if (children && children.classList.contains('tree-children')) {
                    const isOpen = children.classList.toggle('open');
                    toggle.textContent = isOpen ? '▼' : '▶';
                }
            });
        });
    }

    // REPLACE the setupSearchFunctionality function with this fixed version:

function setupSearchFunctionality(container, data, owner, repo) {
    const activateBtn = container.querySelector('#activate-search-btn');
    const searchInputContainer = container.querySelector('#search-input-container');
    const searchResults = container.querySelector('#search-results');
    const filterBtns = container.querySelectorAll('.search-filter-btn');
    const typeFilter = container.querySelector('#file-type-filter');
    const sizeFilter = container.querySelector('#file-size-filter');

    if (!searchResults || !activateBtn) return;

    // Populate file type filter
    const extensions = [...new Set(data.files
        .map(f => f.path.split('.').pop().toLowerCase())
        .filter(ext => ext && ext.length < 10)
    )].sort();

    if (typeFilter) {
        extensions.forEach(ext => {
            const option = document.createElement('option');
            option.value = ext;
            option.textContent = `.${ext}`;
            typeFilter.appendChild(option);
        });
    }

    let currentFilter = 'all';
    let currentTypeFilter = '';
    let currentSizeFilter = '';
    let searchActivated = false;
    let userHasTyped = false;
    let activeInput = null;

    // Only show input when button is clicked
    activateBtn.addEventListener('click', () => {
        searchActivated = true;
        userHasTyped = false;
        activateBtn.style.display = 'none';
        searchInputContainer.style.display = 'block';
        
        // CRITICAL FIX: Create input with maximum autofill prevention
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.className = 'search-input';
        newInput.id = 'search-' + Math.random().toString(36).substr(2, 9); // Random unique ID
        newInput.name = 'search-' + Date.now(); // Random unique name
        
        // NUCLEAR OPTION: All possible autofill prevention attributes
        newInput.setAttribute('autocomplete', 'off');
        newInput.setAttribute('autocorrect', 'off');
        newInput.setAttribute('autocapitalize', 'off');
        newInput.setAttribute('spellcheck', 'false');
        newInput.setAttribute('data-form-type', 'other'); // Tells browser this isn't a form
        newInput.setAttribute('data-lpignore', 'true'); // LastPass ignore
        newInput.setAttribute('data-1p-ignore', 'true'); // 1Password ignore
        newInput.setAttribute('aria-autocomplete', 'none');
        newInput.placeholder = 'Type to search files...';
        newInput.value = '';
        newInput.readOnly = true; // Start as readonly
        
        // Clear container and add new input
        searchInputContainer.innerHTML = '';
        searchInputContainer.appendChild(newInput);
        
        activeInput = newInput;
        
        // AGGRESSIVE CLEAR: Monitor for autofill every 10ms for 2 seconds
        let clearAttempts = 0;
        const maxAttempts = 200; // 2 seconds worth
        const aggressiveClear = setInterval(() => {
            // If input has value but user hasn't typed, clear it
            if (!userHasTyped && newInput.value) {
                newInput.value = '';
            }
            
            clearAttempts++;
            if (clearAttempts >= maxAttempts) {
                clearInterval(aggressiveClear);
            }
        }, 10);
        
        // DELAYED ACTIVATION: Make input functional after 500ms
        setTimeout(() => {
            newInput.readOnly = false;
            
            // Track REAL user typing (not autofill)
            newInput.addEventListener('keydown', (e) => {
                // Only count actual keyboard input
                if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
                    userHasTyped = true;
                }
            });
            
            // Only process input if user has actually typed
            newInput.addEventListener('input', (e) => {
                // REJECT autofill values
                if (!userHasTyped) {
                    newInput.value = '';
                    return;
                }
                
                // Extra safety: Reject email-like patterns
                const value = newInput.value;
                if (value.includes('@') && value.includes('.') && value.split('@').length === 2) {
                    newInput.value = '';
                    return;
                }
                
                performSearch(newInput.value.trim());
            });
            
            // Clear on focus if autofilled
            newInput.addEventListener('focus', () => {
                if (!userHasTyped && newInput.value) {
                    newInput.value = '';
                }
            });
            
            // Clear on click
            newInput.addEventListener('click', () => {
                if (!userHasTyped && newInput.value) {
                    newInput.value = '';
                }
            });
            
            // Focus the input
            newInput.focus();
            
        }, 500); // 500ms delay before input becomes functional
        
        // EXTRA SAFETY: Monitor for value changes without user input
        const observer = new MutationObserver(() => {
            if (!userHasTyped && activeInput && activeInput.value) {
                activeInput.value = '';
            }
        });
        
        observer.observe(newInput, {
            attributes: true,
            attributeFilter: ['value']
        });
        
        // Cleanup observer after 3 seconds
        setTimeout(() => observer.disconnect(), 3000);
    });

    function performSearch(query) {
        // Never search without user typing
        if (!searchActivated || !userHasTyped) {
            searchResults.innerHTML = '';
            return;
        }
        
        // Reject email-like queries
        if (query.includes('@') && !query.includes('/')) {
            searchResults.innerHTML = '';
            if (activeInput) activeInput.value = '';
            return;
        }
    
        let filteredFiles = data.files;
    
        if (currentFilter !== 'all') {
            filteredFiles = data.categorized[currentFilter] || [];
        }
    
        if (currentTypeFilter) {
            filteredFiles = filteredFiles.filter(f =>
                f.path.toLowerCase().endsWith(`.${currentTypeFilter}`)
            );
        }
    
        if (currentSizeFilter) {
            filteredFiles = filteredFiles.filter(f => {
                const size = f.size || 0;
                if (currentSizeFilter === 'small') return size < 10240;
                if (currentSizeFilter === 'medium') return size >= 10240 && size <= 102400;
                if (currentSizeFilter === 'large') return size > 102400;
                return true;
            });
        }
    
        let matches = filteredFiles;
        if (query) {
            matches = filteredFiles
                .map(file => ({
                    file,
                    score: fuzzyMatch(file.path, query)
                }))
                .filter(item => item.score > 0)
                .sort((a, b) => b.score - a.score)
                .map(item => item.file)
                .slice(0, 30);
        } else {
            matches = matches.slice(0, 30);
        }
    
        if (matches.length === 0) {
            searchResults.innerHTML = `
                <div style="color: #8b949e; font-size: 13px; padding: 12px 0; text-align: center;">
                    No files found ${query ? `matching "${query}"` : ''}
                </div>`;
            return;
        }
    
        searchResults.innerHTML = `
            <div style="color: #8b949e; font-size: 12px; margin-bottom: 12px;">
                Found ${matches.length} file${matches.length !== 1 ? 's' : ''}
            </div>
            ${matches.map(file => `
                <div class="file-item" data-path="${file.path}">
                    <div class="file-name">${file.path.split('/').pop()}</div>
                    <div class="file-path">${file.path}</div>
                    ${file.size ? `<span class="file-type-badge">${formatBytes(file.size)}</span>` : ''}
                </div>
            `).join('')}
        `;
    
        searchResults.querySelectorAll('.file-item[data-path]').forEach(el => {
            const path = el.getAttribute('data-path');
            el.style.cursor = 'pointer';
    
            el.addEventListener('click', (e) => {
                const existing = el.querySelector('.file-recommendations');
                if (existing) {
                    existing.remove();
                    return;
                }
    
                const recsDiv = document.createElement('div');
                recsDiv.className = 'file-recommendations';
                recsDiv.style.cssText = `
                    margin-top: 10px;
                    padding: 10px;
                    background: rgba(88, 166, 255, 0.05);
                    border: 1px solid rgba(88, 166, 255, 0.2);
                    border-radius: 6px;
                `;
    
                recsDiv.innerHTML = `
                    <button class="btn-secondary open-github-btn"
                        style="width:100%; font-size:11px; padding:6px;">
                        Open on GitHub
                    </button>
                `;
    
                el.appendChild(recsDiv);
    
                recsDiv.querySelector('.open-github-btn')
                    .addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        window.open(
                            `https://github.com/${owner}/${repo}/blob/${globalDefaultBranch}/${path}`,
                            '_blank'
                        );
                    });
    
                e.stopPropagation();
            });
        });
    }

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            if (searchActivated && userHasTyped && activeInput) {
                performSearch(activeInput.value.trim());
            }
        });
    });

    if (typeFilter) {
        typeFilter.addEventListener('change', (e) => {
            currentTypeFilter = e.target.value;
            if (searchActivated && userHasTyped && activeInput) {
                performSearch(activeInput.value.trim());
            }
        });
    }

    if (sizeFilter) {
        sizeFilter.addEventListener('change', (e) => {
            currentSizeFilter = e.target.value;
            if (searchActivated && userHasTyped && activeInput) {
                performSearch(activeInput.value.trim());
            }
        });
    }
}

    function setupCloneTools(container, owner, repo) {
        const cloneUrl = container.querySelector('#clone-url');
        const copyCloneBtn = container.querySelector('#copy-clone-btn');
        const httpsBtn = container.querySelector('#clone-https-btn');
        const sshBtn = container.querySelector('#clone-ssh-btn');

        let isHttps = true;

        function updateCloneUrl() {
            if (isHttps) {
                cloneUrl.textContent = `https://github.com/${owner}/${repo}.git`;
            } else {
                cloneUrl.textContent = `git@github.com:${owner}/${repo}.git`;
            }
        }

        if (httpsBtn) {
            httpsBtn.addEventListener('click', () => {
                isHttps = true;
                updateCloneUrl();
                httpsBtn.style.background = '#30363d';
                sshBtn.style.background = '#21262d';
            });
        }

        if (sshBtn) {
            sshBtn.addEventListener('click', () => {
                isHttps = false;
                updateCloneUrl();
                sshBtn.style.background = '#30363d';
                httpsBtn.style.background = '#21262d';
            });
        }

        if (copyCloneBtn) {
            copyCloneBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(cloneUrl.textContent).then(() => {
                    copyCloneBtn.textContent = 'Copied!';
                    copyCloneBtn.classList.add('copied');
                    setTimeout(() => {
                        copyCloneBtn.textContent = 'Copy';
                        copyCloneBtn.classList.remove('copied');
                    }, 2000);
                });
            });
        }

        container.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
            btn.addEventListener('click', () => {
                copyToClipboard(btn.dataset.copy, btn);
            });
        });
        
    }

    function setupExportTools(container, data, owner, repo) {
        const jsonBtn = container.querySelector('#export-json-btn');
        const mdBtn = container.querySelector('#export-md-btn');
        const mermaidBtn = container.querySelector('#export-mermaid-btn');
        const mermaidDetailedBtn = container.querySelector('#export-mermaid-detailed-btn');

        if (jsonBtn) {
            jsonBtn.addEventListener('click', () => {
                const exportData = {
                    repository: `${owner}/${repo}`,
                    analyzedAt: new Date().toISOString(),
                    stats: data.stats,
                    metrics: data.metrics,
                    dependencies: data.dependencies,
                    security: data.security,
                    techStack: data.techStack
                };

                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${repo}-analysis.json`;
                a.click();
                URL.revokeObjectURL(url);
            });
        }

        if (mdBtn) {
            mdBtn.addEventListener('click', () => {
                let markdown = `# ${owner}/${repo} - Repository Analysis\n\n`;
                markdown += `Generated: ${new Date().toLocaleString()}\n\n`;
                markdown += `## Overview\n\n`;
                markdown += `- **Language**: ${data.stats.language || 'Unknown'}\n`;
                markdown += `- **Stars**: ${data.stats.stars.toLocaleString()}\n`;
                markdown += `- **Forks**: ${data.stats.forks.toLocaleString()}\n`;
                markdown += `- **Total Files**: ${data.stats.totalFiles.toLocaleString()}\n`;
                markdown += `- **Health Score**: ${data.stats.healthScore}/100\n\n`;

                markdown += `## Code Metrics\n\n`;
                markdown += `- **Estimated Lines**: ${data.metrics.estimatedLines.toLocaleString()}\n`;
                markdown += `- **Code Files**: ${data.metrics.codeFiles}\n`;
                markdown += `- **Complexity Score**: ${data.metrics.complexity}\n\n`;

                if (data.security.length > 0) {
                    markdown += `## Security Issues\n\n`;
                    data.security.forEach(issue => {
                        markdown += `- **[${issue.severity.toUpperCase()}]** ${issue.title}: ${issue.description}\n`;
                    });
                    markdown += '\n';
                }

                const blob = new Blob([markdown], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${repo}-analysis.md`;
                a.click();
                URL.revokeObjectURL(url);
            });
        }

        if (mermaidBtn) {
            mermaidBtn.addEventListener('click', () => {
                const diagram = generateMermaidDiagram(data);
                const blob = new Blob([diagram], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${repo}-architecture.mmd`;
                a.click();
                URL.revokeObjectURL(url);
            });
        }

        if (mermaidDetailedBtn) {
            mermaidDetailedBtn.addEventListener('click', () => {
                const diagram = generateDetailedMermaid(data);
                const blob = new Blob([diagram], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${repo}-detailed-structure.mmd`;
                a.click();
                URL.revokeObjectURL(url);
            });
        }
    }


    function setupVisualizationToggle(container, data, owner, repo) {
        // Don't initialize graph immediately - wait for tab click
        const visualizeTab = document.querySelector('[data-tab="visualize"]');
        let graphInitialized = false;

        if (visualizeTab) {
            visualizeTab.addEventListener('click', () => {
                if (!graphInitialized) {
                    // Only initialize once when user clicks the visualize tab
                    setTimeout(() => {
                        initForceGraphVisualization('viz-graph', data.files, owner, repo);
                        graphInitialized = true;
                    }, 100);
                }
            });
        }
    }

    function copyToClipboard(text, button) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.classList.add('copied');
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        });
    }

    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    function showError(sidebar, message) {
        const content = sidebar.querySelector('#sidebar-main-content');
    
        const tokenBanner = sidebar.querySelector('#token-setup-banner');
    
        // Show token setup banner for these errors
        if (message.includes('private') || 
            message.includes('404') || 
            message.includes('not found') ||
            message.includes('rate limit')) {
            if (tokenBanner) {
                tokenBanner.style.display = 'block';
            }
        }
    
        let errorTitle = 'Error Loading Repository';
        let errorMessage = message;
        let suggestions = [];
    
        if (message.includes('rate limit')) {
            errorTitle = 'GitHub API Rate Limit Exceeded';
            suggestions = [
                'Wait for the rate limit to reset',
                'Add a GitHub personal access token to increase limit to 5000/hour',
                'Try a smaller repository'
            ];
        } else if (message.includes('not found')) {
            errorTitle = 'Repository Not Found';
            suggestions = [
                'Check that the repository exists',
                'Make sure the URL is correct',
                'Try refreshing the page',
                'Add a GitHub token if this is a private repository'
            ];
        } else if (message.includes('tree')) {
            errorTitle = 'Could Not Load Repository Files';
            suggestions = [
                'The repository might be empty',
                'Try refreshing the page',
                'Check your internet connection'
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
                                ${suggestions.map(s => `<li style="margin-bottom: 4px;">${s}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
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