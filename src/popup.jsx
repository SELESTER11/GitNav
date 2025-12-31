import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/styles.css';

function Popup() {
  return (
    <div className="popup-container">
      <h2>GitHub Codebase Navigator</h2>
      <p>Navigate to any GitHub repository and click the "Analyze Codebase" button to start.</p>
      <div className="popup-info">
        <h3>Features:</h3>
        <ul>
          <li>Visual codebase map</li>
          <li>Smart search</li>
          <li>AI-powered summary</li>
          <li>Key files finder</li>
          <li>Dependency tracker</li>
          <li>Onboarding guide</li>
        </ul>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Popup />);