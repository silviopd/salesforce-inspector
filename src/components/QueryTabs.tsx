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

interface SalesforceObject {
  name: string;
  label: string;
  labelPlural?: string;
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
  const [objectsError, setObjectsError] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const queryEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const [objectsCache, setObjectsCache] = useState<SalesforceObject[]>([]);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);

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

  const isInFromClause = useMemo(() => {
    if (!activeQuery || cursorPosition < 0) {
      return false;
    }
    const prefix = activeQuery.slice(0, cursorPosition);
    const fromMatch = prefix.match(/\bfrom\s+([a-zA-Z0-9_]*)$/i);
    return fromMatch !== null;
  }, [activeQuery, cursorPosition]);

  const shouldShowFieldSuggestions = useMemo(() => {
    if (!activeQuery || cursorPosition < 0 || !activeObjectName) {
      return false;
    }
    
    // No mostrar sugerencias si estamos en la cláusula FROM
    if (isInFromClause) {
      return false;
    }
    
    // Si hay un objeto activo (FROM ya fue detectado), mostrar sugerencias
    return true;
  }, [activeQuery, cursorPosition, activeObjectName, isInFromClause]);

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
    if (!term) {
      return fieldsToUse;
    }
    
    // Filtrar campos con búsqueda parcial simple
    const list = fieldsToUse.filter(field => {
      const nameToMatch = (field.relationshipName || field.name).toLowerCase();
      const label = (field.label || '').toLowerCase();
      
      // Buscar si contiene el término en el nombre o label
      return nameToMatch.includes(term) || label.includes(term);
    });
    
    return list;
  }, [relationshipContext, targetFields, availableFields]);

  // Separar campos normales de campos de relación
  const { normalFields, relationshipFields } = useMemo(() => {
    if (relationshipContext.isRelationship) {
      // Si estamos dentro de una relación, todos son campos normales del objeto relacionado
      return { normalFields: filteredSuggestions, relationshipFields: [] };
    }
    
    const normal: SalesforceFieldDefinition[] = [];
    const relationships: SalesforceFieldDefinition[] = [];
    
    filteredSuggestions.forEach(field => {
      if (field.relationshipName) {
        // Si tiene relationshipName, agregarlo a relaciones
        relationships.push(field);
        // Si el campo termina en "Id", también agregarlo a campos normales
        if (field.name.endsWith('Id')) {
          normal.push(field);
        }
      } else {
        // Si no tiene relationshipName, es un campo normal
        normal.push(field);
      }
    });
    
    return { normalFields: normal, relationshipFields: relationships };
  }, [filteredSuggestions, relationshipContext.isRelationship]);

  // Lista unificada de sugerencias para vista compacta
  const allSuggestions = useMemo(() => {
    return [...normalFields, ...relationshipFields];
  }, [normalFields, relationshipFields]);

  const filteredObjects = useMemo(() => {
    if (!objectsCache.length) {
      return [] as SalesforceObject[];
    }
    const term = currentWord.trim().toLowerCase();
    if (!term) {
      return objectsCache;
    }
    
    // Filtrar objetos con búsqueda parcial simple
    const list = objectsCache.filter(obj => {
      const name = obj.name.toLowerCase();
      const label = (obj.label || '').toLowerCase();
      
      // Buscar si contiene el término en el nombre o label
      return name.includes(term) || label.includes(term);
    });
    
    return list;
  }, [objectsCache, currentWord]);

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

  useEffect(() => {
    if (objectsCache.length > 0) {
      return;
    }

    let isMounted = true;
    setLoadingObjects(true);

    invoke<{sobjects: SalesforceObject[]}>('list_sobjects', {
      instanceUrl,
      accessToken,
    })
      .then(response => {
        if (!isMounted) return;
        const sorted = [...response.sobjects].sort((a, b) => a.name.localeCompare(b.name));
        setObjectsCache(sorted);
      })
      .catch(err => {
        if (!isMounted) return;
        console.error('Error cargando objetos:', err);
        setObjectsError(typeof err === 'string' ? err : JSON.stringify(err));
      })
      .finally(() => {
        if (!isMounted) return;
        setLoadingObjects(false);
      });

    return () => {
      isMounted = false;
    };
  }, [instanceUrl, accessToken]);

  const updateCursorFromEvent = (event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    setCursorPosition(target.selectionStart ?? 0);
  };

  const insertSuggestion = (text: string, isObject = false) => {
    if (!activeTabConfig) {
      return;
    }

    let startIndex: number;
    let textToInsert: string;

    if (isObject) {
      // Insertar objeto en FROM
      const wordLength = currentWord.length;
      startIndex = Math.max(0, cursorPosition - wordLength);
      textToInsert = text;
    } else if (relationshipContext.isRelationship) {
      // Estamos en una relación (ej. Owner.Name)
      const searchTermLength = relationshipContext.searchTerm.length;
      startIndex = cursorPosition - searchTermLength;
      textToInsert = text;
    } else {
      // Estamos en el objeto principal
      const wordLength = currentWord.length;
      startIndex = Math.max(0, cursorPosition - wordLength);
      textToInsert = text;
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

  const insertFieldSuggestion = (fieldName: string) => {
    insertSuggestion(fieldName, false);
  };

  const insertObjectSuggestion = (objectName: string) => {
    insertSuggestion(objectName, true);
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

    // Normalizar comillas: reemplazar comillas curvas/tipográficas por comillas rectas
    const normalizedQuery = trimmedQuery
      .replace(/[\u2018\u2019]/g, "'")  // Comillas simples curvas → rectas
      .replace(/[\u201C\u201D]/g, '"'); // Comillas dobles curvas → rectas

    setIsRunning(true);
    setError('');
    setResultStatus('Ejecutando consulta...');

    try {
      const response = await invoke<SalesforceQueryResult>('run_soql_query', {
        instanceUrl,
        accessToken,
        query: normalizedQuery,
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

      <div className="query-actions">
        <div className="action-buttons">
          <button className="run-button" onClick={runQuery} disabled={isRunning}>
            {isRunning ? 'Running...' : 'Run Query'}
          </button>
          <button disabled>Export Query</button>
          <button disabled>Query Plan</button>
        </div>
        <button 
          className={`suggestions-toggle-button ${suggestionsExpanded ? 'active' : ''}`}
          onClick={() => setSuggestionsExpanded(!suggestionsExpanded)}
          title={suggestionsExpanded ? "Ocultar sugerencias" : "Mostrar todas las sugerencias"}
        >
          💡 {suggestionsExpanded ? 'Ocultar' : 'Sugerencias'}
        </button>
      </div>

      {/* Sugerencias inline (siempre visible, se expande con el botón) */}
      {(shouldShowFieldSuggestions || isInFromClause) && activeObjectName && (
        <div className={`field-suggestions-inline ${suggestionsExpanded ? 'expanded' : ''}`}>
          <div className="suggestions-inline-label">
            {isInFromClause ? 'Objetos:' : `${relationshipContext.isRelationship ? targetObjectName : activeObjectName}:`}
          </div>
          <div className="suggestions-inline-chips">
            {isInFromClause ? (
              <>
                {filteredObjects.map(obj => (
                  <button
                    type="button"
                    key={obj.name}
                    className="field-chip-inline field-chip-object"
                    onClick={() => insertObjectSuggestion(obj.name)}
                    title={obj.label && obj.label !== obj.name ? obj.label : undefined}
                  >
                    {obj.name}
                  </button>
                ))}
              </>
            ) : (
              <>
                {/* Primero los campos normales */}
                {normalFields.map(field => (
                  <button
                    type="button"
                    key={`normal-${field.name}`}
                    className="field-chip-inline"
                    onClick={() => insertFieldSuggestion(field.name)}
                    title={field.label || field.name}
                  >
                    {field.name}
                  </button>
                ))}
                {/* Luego los campos relacionados */}
                {relationshipFields.map(field => (
                  <button
                    type="button"
                    key={`rel-${field.name}`}
                    className="field-chip-inline field-chip-relationship"
                    onClick={() => insertFieldSuggestion(field.relationshipName || field.name)}
                    title={field.label || field.name}
                  >
                    {field.relationshipName || field.name} 🔗
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}

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
