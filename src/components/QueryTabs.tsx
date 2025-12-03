import React, { useState } from 'react';
import './QueryTabs.css';

const QueryTabs: React.FC = () => {
  const [tabs, setTabs] = useState([{ id: 1, name: 'Query 1', query: 'select fields(all)\nfrom user\nlimit 200' }]);
  const [activeTab, setActiveTab] = useState(1);

  const addTab = () => {
    const newTabId = tabs.length > 0 ? Math.max(...tabs.map(t => t.id)) + 1 : 1;
    setTabs([...tabs, { id: newTabId, name: `Query ${newTabId}`, query: '' }]);
    setActiveTab(newTabId);
  };

  const closeTab = (tabId: number) => {
    const tabIndex = tabs.findIndex(t => t.id === tabId);
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);

    if (activeTab === tabId && newTabs.length > 0) {
      const newActiveIndex = Math.max(0, tabIndex - 1);
      setActiveTab(newTabs[newActiveIndex].id);
    } else if (newTabs.length === 0) {
      addTab();
    }
  };

  const handleQueryChange = (tabId: number, newQuery: string) => {
    const newTabs = tabs.map(tab => 
      tab.id === tabId ? { ...tab, query: newQuery } : tab
    );
    setTabs(newTabs);
  };

  const activeQuery = tabs.find(t => t.id === activeTab)?.query ?? '';

  return (
    <div className="export-query-container">
      <div className="toolbar">
        <div className="left-toolbar">
          <select>
            <option>Templates</option>
          </select>
          <select>
            <option>Query History</option>
          </select>
          <button>Clear</button>
          <select>
            <option>Saved Queries</option>
          </select>
          <input type="text" placeholder="Query Label" />
          <button>Save Query</button>
        </div>
        <div className="right-toolbar">
          <label>
            <input type="checkbox" />
            Deleted/Archived Records?
          </label>
          <label>
            <input type="checkbox" />
            Tooling API?
          </label>
        </div>
      </div>

      <div className="query-tabs-bar">
        {tabs.map(tab => (
          <div key={tab.id} className={`query-tab ${activeTab === tab.id ? 'active' : ''}`}>
            <span onClick={() => setActiveTab(tab.id)}>{tab.name}</span>
            <button className="close-query-tab" onClick={() => closeTab(tab.id)}>×</button>
          </div>
        ))}
        <button className="add-query-tab" onClick={addTab}>+</button>
      </div>

      <textarea
        className="query-editor"
        value={activeQuery}
        onChange={(e) => handleQueryChange(activeTab, e.target.value)}
        placeholder="Enter your SOQL query here..."
      />

      <div className="query-actions">
        <button className="run-button">Run Export</button>
        <button>Export Query</button>
        <button>Query Plan</button>
        <div className="dropdown-container">
          <button className="icon-button">💡</button>
        </div>
      </div>

      <div className="export-result-container">
        <div className="result-toolbar">
            <button>Copy (Excel)</button>
            <button>Copy (CSV)</button>
            <button>Copy (JSON)</button>
            <button className="icon-button">📥</button>
            <button className="icon-button">🚫</button>
            <button className="danger-button">Delete Records</button>
            <input type="text" placeholder="🔍 Filter" />
        </div>
        <div className="result-status">
            <span>Ready</span>
            <button>Stop</button>
        </div>
      </div>
    </div>
  );
};

export default QueryTabs;
