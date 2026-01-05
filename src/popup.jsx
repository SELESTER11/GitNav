// REPLACE popup.jsx with this:

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/styles.css';

function Popup() {
  return (
    <div className="popup-container">
      <div className="popup-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <img 
            src={chrome.runtime.getURL('icons/logo32light.png')} 
            alt="GitNav Logo" 
            style={{ width: '32px', height: '32px', borderRadius: '6px' }} 
          />
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>GitNav</h2>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>v2.0.0</div>
          </div>
        </div>
      </div>

      <div className="popup-instructions">
        <div style={{ 
          background: 'rgba(88, 166, 255, 0.1)', 
          border: '1px solid rgba(88, 166, 255, 0.3)',
          borderRadius: '6px',
          padding: '12px',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--text-link)' }}>
            Quick Start
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            Navigate to any GitHub repository and click the <strong style={{ color: 'var(--text-primary)' }}>Analyze Codebase</strong> button to start exploring
          </div>
        </div>
      </div>

      <div className="popup-features">
        <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Features</h3>
        
        <div className="feature-grid">
          <div className="feature-card">
            <div className="feature-text">
              <div className="feature-title">Visual Map</div>
              <div className="feature-desc">Interactive repository visualization</div>
            </div>
          </div>

          <div className="feature-card">
            <div className="feature-text">
              <div className="feature-title">Smart Search</div>
              <div className="feature-desc">Find files instantly</div>
            </div>
          </div>

          <div className="feature-card">
            <div className="feature-text">
              <div className="feature-title">Code Metrics</div>
              <div className="feature-desc">Complexity and health scores</div>
            </div>
          </div>

          <div className="feature-card">
            <div className="feature-text">
              <div className="feature-title">Security Check</div>
              <div className="feature-desc">Detect vulnerabilities</div>
            </div>
          </div>

          <div className="feature-card">
            <div className="feature-text">
              <div className="feature-title">Dependencies</div>
              <div className="feature-desc">Track package versions</div>
            </div>
          </div>

          <div className="feature-card">
            <div className="feature-text">
              <div className="feature-title">Key Files</div>
              <div className="feature-desc">Quick onboarding guide</div>
            </div>
          </div>
        </div>
      </div>

      <div className="popup-footer">
        <div style={{ 
          display: 'flex', 
          gap: '8px', 
          marginBottom: '12px' 
        }}>
          <button 
            className="popup-btn primary"
            onClick={() => chrome.tabs.create({ url: 'https://github.com/SELESTER11/GitNav' })}
          >
            Star on GitHub
          </button>
          <button 
            className="popup-btn secondary"
            onClick={() => chrome.tabs.create({ url: 'https://github.com/SELESTER11/GitNav/issues' })}
          >
            Report Issue
          </button>
        </div>
        
        <div style={{ 
          textAlign: 'center', 
          fontSize: '11px', 
          color: 'var(--text-secondary)',
          paddingTop: '12px',
          borderTop: '1px solid var(--border-primary)'
        }}>
          Made with love by Varun Karamchandani
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Popup />);