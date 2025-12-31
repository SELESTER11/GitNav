chrome.runtime.onInstalled.addListener(() => {
  console.log("GitNav - GitHub Repository Navigator installed");
});

// Handle any future background tasks here
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Reserved for future features
  return true;
});
