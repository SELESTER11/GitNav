const GITHUB_API = 'https://api.github.com';

export async function fetchRepoTree(owner, repo, branch = 'main') {
  try {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const response = await fetch(url);
    
    if (!response.ok) {
      if (branch === 'main') {
        return fetchRepoTree(owner, repo, 'master');
      }
      throw new Error(`Failed to fetch repo: ${response.status}`);
    }

    const data = await response.json();
    return data.tree;
  } catch (error) {
    console.error('Error fetching repo tree:', error);
    throw error;
  }
}

export async function fetchRepoInfo(owner, repo) {
  try {
    const url = `${GITHUB_API}/repos/${owner}/${repo}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch repo info: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching repo info:', error);
    throw error;
  }
}

export async function fetchFileContent(owner, repo, path) {
  try {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`);
    }

    const data = await response.json();
    return atob(data.content);
  } catch (error) {
    console.error('Error fetching file content:', error);
    throw error;
  }
}