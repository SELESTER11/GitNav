chrome.runtime.onInstalled.addListener(() => {
  console.log("GitNav - GitHub Repository Navigator installed");
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  return true;
});
