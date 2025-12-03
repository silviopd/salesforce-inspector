import React, { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './QueryTabs.css';

interface QueryTabConfig {
  id: number;
  name: string;
  query: string;
}

interface SalesforceQueryResult {
  done: boolean;
  totalSize: number;
  records: Record<string, unknown>[];
  nextRecordsUrl?: string | null;
}

interface QueryTabsProps {
  instanceUrl: string;
  accessToken: string;
  connectionAlias: string;
}

const DEFAULT_QUERY = 'SELECT Id, Name FROM Account LIMIT 200';

const QueryTabs: React.FC<QueryTabsProps> = ({ instanceUrl, accessToken, connectionAlias }) => {
  const [tabs, setTabs] = useState<QueryTabConfig[]>([
    { id: 1, name: 'Query 1', query: DEFAULT_QUERY },
  ]);
  const [activeTab, setActiveTab] = useState(1);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [useTooling, setUseTooling] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');
  const [resultStatus, setResultStatus] = useState('Ready');
  const [results, setResults] = useState<SalesforceQueryResult | null>(null);

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

  const activeTabConfig = tabs.find(t => t.id === activeTab);
  const activeQuery = activeTabConfig?.query ?? '';

  const resultColumns = useMemo(() => {
    if (!results?.records?.length) {
      return [] as string[];
    }

    const columns = new Set<string>();
    results.records.forEach(record => {
      if (record && typeof record === 'object') {
        Object.keys(record).forEach(key => {
          if (key !== 'attributes') {
            columns.add(key);
          }
        });
      }
    });

    return Array.from(columns);
  }, [results]);

  const runQuery = async () => {
    if (!activeTabConfig) {
      return;
    }

    const trimmedQuery = activeTabConfig.query.trim();
    if (!trimmedQuery) {
      setError('Ingresa una consulta SOQL válida.');
      return;
    }

    setIsRunning(true);
    setError('');
    setResultStatus('Ejecutando consulta...');

    try {
      const response = await invoke<SalesforceQueryResult>('run_soql_query', {
        instanceUrl,
        accessToken,
        query: trimmedQuery,
        useTooling,
        includeDeleted,
      });

      setResults(response);
      const fetched = response.records?.length ?? 0;
      setResultStatus(`Resultados: ${fetched} registros (Total: ${response.totalSize})`);
    } catch (err) {
      const message = typeof err === 'string' ? err : JSON.stringify(err);
      setError(message);
      setResultStatus('Error al ejecutar la consulta');
    } finally {
      setIsRunning(false);
    }
  };

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
          <button
            onClick={() => {
              if (!activeTabConfig) return;
              handleQueryChange(activeTabConfig.id, DEFAULT_QUERY);
            }}
          >
            Clear
          </button>
          <select>
            <option>Saved Queries</option>
          </select>
          <input type="text" placeholder="Query Label" />
          <button>Save Query</button>
        </div>
        <div className="right-toolbar">
          <label>
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => setIncludeDeleted(e.target.checked)}
            />
            Deleted/Archived Records?
          </label>
          <label>
            <input
              type="checkbox"
              checked={useTooling}
              onChange={(e) => setUseTooling(e.target.checked)}
            />
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

      {error && <div className="query-error">{error}</div>}

      <div className="query-actions">
        <button className="run-button" onClick={runQuery} disabled={isRunning}>
          {isRunning ? 'Running...' : 'Run Query'}
        </button>
        <button disabled>Export Query</button>
        <button disabled>Query Plan</button>
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
            <span>{resultStatus}</span>
            <button disabled={!isRunning}>Stop</button>
        </div>
      </div>

      <div className="query-results">
        {results?.records?.length ? (
          <div className="query-results-table-wrapper">
            <table className="query-results-table">
              <thead>
                <tr>
                  {resultColumns.map(column => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.records.map((record, rowIndex) => (
                  <tr key={rowIndex}>
                    {resultColumns.map(column => {
                      const value = (record as Record<string, unknown>)[column];
                      const displayValue =
                        value === null || value === undefined
                          ? ''
                          : typeof value === 'object'
                            ? JSON.stringify(value)
                            : String(value);
                      return <td key={column}>{displayValue}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="query-empty-state">
            {isRunning ? 'Ejecutando consulta...' : 'No hay resultados todavía.'}
          </div>
        )}
      </div>
    </div>
  );
};

export default QueryTabs;
