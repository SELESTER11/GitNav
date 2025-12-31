chrome.runtime.onInstalled.addListener(() => {
    console.log('GitHub Codebase Navigator installed');
  });
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'generateSummary') {
      generateAISummary(request.data)
        .then(summary => sendResponse({ success: true, summary }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep channel open for async response
    }
  });
  
  async function generateAISummary(data) {
    const HF_API = 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn';
    
    const input = `
  Repository: ${data.info.name}
  Description: ${data.info.description || 'No description available'}
  Primary Language: ${data.stats.language || 'Unknown'}
  Total Files: ${data.stats.totalFiles}
  Stars: ${data.stats.stars}
  Forks: ${data.stats.forks}
  
  Key Files Found: ${data.keyFiles.map(f => f.name).join(', ')}
  
  File Categories:
  - Frontend files: ${data.categorized.frontend.length}
  - Backend files: ${data.categorized.backend.length}
  - Configuration files: ${data.categorized.config.length}
  - Test files: ${data.categorized.tests.length}
  - Documentation files: ${data.categorized.docs.length}
  
  This repository is a ${data.stats.language || 'software'} project. ${data.info.description || 'It contains various files organized into different categories.'}
    `.trim();
  
    const response = await fetch(HF_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: input,
        parameters: {
          max_length: 180,
          min_length: 40,
          do_sample: false
        }
      })
    });
  
    if (!response.ok) throw new Error('AI service unavailable');
  
    const result = await response.json();
    return result[0]?.summary_text || data.info.description || 'A software development project.';
  }