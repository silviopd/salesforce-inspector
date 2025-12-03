import React, { useEffect, useMemo, useRef, useState } from 'react';
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

interface SalesforceFieldDefinition {
  name: string;
  label?: string;
  fieldType?: string;
  relationshipName?: string;
  referenceTo?: string[];
}

interface SalesforceDescribeResult {
  fields: SalesforceFieldDefinition[];
}

interface QueryTabsProps {
  instanceUrl: string;
  accessToken: string;
  connectionAlias: string;
}

const DEFAULT_QUERY = 'SELECT Id, Name FROM Account LIMIT 200';
const MAX_SUGGESTIONS = 60;

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
  const [fieldCache, setFieldCache] = useState<Record<string, SalesforceFieldDefinition[]>>({});
  const [loadingFields, setLoadingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const queryEditorRef = useRef<HTMLTextAreaElement | null>(null);

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

  const activeObjectName = useMemo(() => {
    const match = activeQuery.match(/from\s+([a-zA-Z0-9_]+)/i);
    return match?.[1] ?? '';
  }, [activeQuery]);

  const cacheKey = useMemo(() => {
    return activeObjectName ? `${connectionAlias}:${activeObjectName}` : '';
  }, [activeObjectName, connectionAlias]);

  const availableFields = useMemo(() => {
    if (!cacheKey) {
      return [] as SalesforceFieldDefinition[];
    }
    return fieldCache[cacheKey] ?? [];
  }, [cacheKey, fieldCache]);

  const currentWord = useMemo(() => {
    if (!activeQuery || cursorPosition < 0) {
      return '';
    }
    const prefix = activeQuery.slice(0, cursorPosition);
    const match = prefix.match(/([a-zA-Z0-9_\.]+)$/);
    return match?.[1] ?? '';
  }, [activeQuery, cursorPosition]);

  const relationshipContext = useMemo(() => {
    const parts = currentWord.split('.');
    
    // Si no hay punto, estamos en el objeto principal
    if (parts.length < 2) {
      return { objectName: activeObjectName, searchTerm: currentWord, isRelationship: false };
    }

    // Hay punto, buscar la relación
    const relationshipName = parts[0];
    const searchTerm = parts.slice(1).join('.');

    // Buscar el campo que coincida con el relationshipName
    const relationshipField = availableFields.find(
      field => field.relationshipName === relationshipName
    );

    // Si encontramos el campo de relación y tiene referenceTo
    if (relationshipField?.referenceTo?.[0]) {
      return { 
        objectName: relationshipField.referenceTo[0], 
        searchTerm,
        isRelationship: true
      };
    }

    // No se encontró relación válida, quedarse en el objeto principal
    return { objectName: activeObjectName, searchTerm: currentWord, isRelationship: false };
  }, [currentWord, activeObjectName, availableFields]);

  const targetObjectName = relationshipContext.isRelationship 
    ? relationshipContext.objectName 
    : activeObjectName;

  const targetCacheKey = useMemo(() => {
    return targetObjectName ? `${connectionAlias}:${targetObjectName}` : '';
  }, [targetObjectName, connectionAlias]);

  const targetFields = useMemo(() => {
    if (!targetCacheKey) {
      return [] as SalesforceFieldDefinition[];
    }
    return fieldCache[targetCacheKey] ?? [];
  }, [targetCacheKey, fieldCache]);

  const filteredSuggestions = useMemo(() => {
    const fieldsToUse = relationshipContext.isRelationship ? targetFields : availableFields;
    if (!fieldsToUse.length) {
      return [] as SalesforceFieldDefinition[];
    }
    const term = relationshipContext.searchTerm.trim().toLowerCase();
    const list = term
      ? fieldsToUse.filter(field => field.name.toLowerCase().startsWith(term))
      : fieldsToUse;
    return list.slice(0, MAX_SUGGESTIONS);
  }, [relationshipContext, targetFields, availableFields]);

  const resultColumns = useMemo(() => {
    if (!results?.records?.length) {
      return [] as string[];
    }

    const columns = new Set<string>();
    const flattenKeys = (obj: Record<string, unknown>, prefix = '') => {
      Object.keys(obj).forEach(key => {
        if (key === 'attributes') return;
        
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          flattenKeys(value as Record<string, unknown>, fullKey);
        } else {
          columns.add(fullKey);
        }
      });
    };

    results.records.forEach(record => {
      if (record && typeof record === 'object') {
        flattenKeys(record);
      }
    });

    return Array.from(columns);
  }, [results]);

  const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
    const keys = path.split('.');
    let current: any = obj;
    
    for (const key of keys) {
      if (current === null || current === undefined) return null;
      if (typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }
    
    if (current && typeof current === 'object' && 'attributes' in current) {
      return null;
    }
    
    return current;
  };

  useEffect(() => {
    if (!activeObjectName) {
      setFieldsError('');
      setLoadingFields(false);
      return;
    }

    const key = `${connectionAlias}:${activeObjectName}`;
    if (fieldCache[key]) {
      setFieldsError('');
      return;
    }

    let isMounted = true;
    setLoadingFields(true);
    setFieldsError('');

    invoke<SalesforceDescribeResult>('describe_sobject', {
      instanceUrl,
      accessToken,
      objectName: activeObjectName,
    })
      .then(response => {
        if (!isMounted) return;
        const sorted = [...response.fields].sort((a, b) => a.name.localeCompare(b.name));
        setFieldCache(prev => ({
          ...prev,
          [key]: sorted,
        }));
      })
      .catch(err => {
        if (!isMounted) return;
        const message = typeof err === 'string' ? err : JSON.stringify(err);
        setFieldsError(message);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoadingFields(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeObjectName, accessToken, connectionAlias, fieldCache, instanceUrl]);

  useEffect(() => {
    if (!relationshipContext.isRelationship || !targetObjectName) {
      return;
    }

    const key = `${connectionAlias}:${targetObjectName}`;
    if (fieldCache[key]) {
      return;
    }

    let isMounted = true;
    setLoadingFields(true);

    invoke<SalesforceDescribeResult>('describe_sobject', {
      instanceUrl,
      accessToken,
      objectName: targetObjectName,
    })
      .then(response => {
        if (!isMounted) return;
        const sorted = [...response.fields].sort((a, b) => a.name.localeCompare(b.name));
        setFieldCache(prev => ({
          ...prev,
          [key]: sorted,
        }));
      })
      .catch(err => {
        if (!isMounted) return;
        const message = typeof err === 'string' ? err : JSON.stringify(err);
        setFieldsError(message);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoadingFields(false);
      });

    return () => {
      isMounted = false;
    };
  }, [relationshipContext.isRelationship, targetObjectName, accessToken, connectionAlias, fieldCache, instanceUrl]);

  useEffect(() => {
    if (!queryEditorRef.current) {
      return;
    }
    const editor = queryEditorRef.current;
    const pos = editor.value.length;
    requestAnimationFrame(() => {
      editor.setSelectionRange(pos, pos);
    });
    setCursorPosition(pos);
  }, [activeTab]);

  const updateCursorFromEvent = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    setCursorPosition(target.selectionStart ?? 0);
  };

  const insertFieldSuggestion = (fieldName: string) => {
    if (!activeTabConfig) {
      return;
    }

    let startIndex: number;
    let textToInsert: string;

    if (relationshipContext.isRelationship) {
      // Estamos en una relación (ej. Owner.Name)
      // Solo reemplazar la parte después del último punto
      const searchTermLength = relationshipContext.searchTerm.length;
      startIndex = cursorPosition - searchTermLength;
      textToInsert = fieldName;
    } else {
      // Estamos en el objeto principal
      const wordLength = currentWord.length;
      startIndex = Math.max(0, cursorPosition - wordLength);
      textToInsert = fieldName;
    }

    const before = activeQuery.slice(0, startIndex);
    const after = activeQuery.slice(cursorPosition);
    const newQuery = `${before}${textToInsert}${after}`;

    handleQueryChange(activeTabConfig.id, newQuery);

    const nextCursor = startIndex + textToInsert.length;
    requestAnimationFrame(() => {
      if (queryEditorRef.current) {
        queryEditorRef.current.focus();
        queryEditorRef.current.setSelectionRange(nextCursor, nextCursor);
      }
      setCursorPosition(nextCursor);
    });
  };

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
        ref={queryEditorRef}
        className="query-editor"
        value={activeQuery}
        onChange={(e) => {
          handleQueryChange(activeTab, e.target.value);
          setCursorPosition(e.target.selectionStart ?? 0);
        }}
        onSelect={updateCursorFromEvent}
        onKeyUp={updateCursorFromEvent}
        onClick={updateCursorFromEvent}
        placeholder="Enter your SOQL query here..."
      />

      {error && <div className="query-error">{error}</div>}

      <div className="field-suggestions">
        <div className="field-suggestions-header">
          <span>Field suggestions</span>
          {activeObjectName && (
            <span className="field-suggestions-object">
              {relationshipContext.isRelationship ? targetObjectName : activeObjectName}
            </span>
          )}
          {loadingFields && <span className="field-suggestions-loading">Cargando...</span>}
        </div>
        {fieldsError && (
          <div className="field-suggestions-error">{fieldsError}</div>
        )}
        {!activeObjectName && !fieldsError && (
          <div className="field-suggestions-empty">
            Agrega una cláusula FROM para obtener sugerencias de campos.
          </div>
        )}
        {activeObjectName && !fieldsError && !loadingFields && (
          <>
            {filteredSuggestions.length ? (
              <div className="field-suggestions-list">
                {filteredSuggestions.map(field => {
                  const isInRelationshipContext = relationshipContext.isRelationship;
                  const showAsRelationship = !isInRelationshipContext && field.relationshipName;
                  const displayName = showAsRelationship ? (field.relationshipName || field.name) : field.name;
                  
                  return (
                    <button
                      type="button"
                      key={field.name}
                      className={`field-chip ${showAsRelationship ? 'field-chip-relationship' : ''}`}
                      onClick={() => insertFieldSuggestion(displayName)}
                    >
                      <span className="field-chip-name">
                        {displayName}
                        {showAsRelationship && <span className="field-chip-relation-icon">🔗</span>}
                      </span>
                      {field.label && field.label !== field.name && (
                        <span className="field-chip-label">{field.label}</span>
                      )}
                      {showAsRelationship && field.referenceTo && field.referenceTo.length > 0 && (
                        <span className="field-chip-reference">→ {field.referenceTo.join(', ')}</span>
                      )}
                      {field.fieldType && (
                        <span className="field-chip-type">{field.fieldType}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="field-suggestions-empty">
                No hay coincidencias para "{relationshipContext.searchTerm}".
              </div>
            )}
            {(relationshipContext.isRelationship ? targetFields : availableFields).length > MAX_SUGGESTIONS && (
              <div className="field-suggestions-hint">
                Mostrando {MAX_SUGGESTIONS} de {(relationshipContext.isRelationship ? targetFields : availableFields).length} campos. Sigue escribiendo para filtrar más.
              </div>
            )}
          </>
        )}
      </div>

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
                      const value = getNestedValue(record as Record<string, unknown>, column);
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
