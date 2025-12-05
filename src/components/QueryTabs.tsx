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
  const [filterText, setFilterText] = useState('');
  const [filterColumns, setFilterColumns] = useState<string[]>([]);
  const [showColumnDropdown, setShowColumnDropdown] = useState(false);
  const [showFilterOptions, setShowFilterOptions] = useState(false);
  const [filterMode, setFilterMode] = useState<'contains' | 'regex' | 'exact' | 'startsWith' | 'endsWith' | 'empty' | 'notEmpty'>('contains');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [comparisonOperator, setComparisonOperator] = useState<'=' | '!=' | '>' | '<' | '>=' | '<='>('=');
  const [columnSearch, setColumnSearch] = useState('');
  const [copyNotification, setCopyNotification] = useState<string | null>(null);
  const [queryHistory, setQueryHistory] = useState<string[]>([]);
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [showClearHistoryModal, setShowClearHistoryModal] = useState(false);
  const historyDropdownRef = useRef<HTMLDivElement | null>(null);

  const addTab = () => {
    const newTabId = tabs.length > 0 ? Math.max(...tabs.map(t => t.id)) + 1 : 1;
    setTabs([...tabs, { id: newTabId, name: `Query ${newTabId}`, query: '' }]);
    setActiveTab(newTabId);
  };

  // Cargar historial de queries al montar
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await invoke<string[]>('get_query_history', {
          orgIdentifier: instanceUrl
        });
        setQueryHistory(history || []);
      } catch (err) {
        console.error('Error loading query history:', err);
      }
    };
    loadHistory();
  }, [instanceUrl]);

  // Guardar query en el historial
  const addToHistory = async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    try {
      console.log('Adding to history:', { instanceUrl, query: trimmedQuery });
      const updatedHistory = await invoke<string[]>('add_to_query_history', {
        orgIdentifier: instanceUrl,
        query: trimmedQuery
      });
      console.log('History updated:', updatedHistory);
      setQueryHistory(updatedHistory);
    } catch (err) {
      console.error('Error saving to query history:', err);
    }
  };

  // Eliminar query individual del historial
  const removeFromHistory = async (query: string) => {
    try {
      const updatedHistory = await invoke<string[]>('remove_from_query_history', {
        orgIdentifier: instanceUrl,
        query
      });
      setQueryHistory(updatedHistory);
    } catch (err) {
      console.error('Error removing from query history:', err);
    }
  };

  // Limpiar todo el historial
  const clearHistory = async () => {
    try {
      await invoke('clear_query_history', {
        orgIdentifier: instanceUrl
      });
      setQueryHistory([]);
      setShowClearHistoryModal(false);
      setShowHistoryDropdown(false);
    } catch (err) {
      console.error('Error clearing query history:', err);
    }
  };

  // Click outside para cerrar dropdown de historial
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(event.target as Node)) {
        setShowHistoryDropdown(false);
        setHistorySearch('');
      }
    };

    if (showHistoryDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHistoryDropdown]);

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

    // Intentar extraer columnas del query SOQL
    const query = activeTabConfig?.query || '';
    const selectMatch = query.match(/SELECT\s+(.*?)\s+FROM/is);
    
    if (selectMatch) {
      const selectClause = selectMatch[1];
      
      // Parsear las columnas del SELECT
      const queryColumns = selectClause
        .split(',')
        .map(col => col.trim())
        .filter(col => col && col.toLowerCase() !== 'count()');
      
      // Verificar si todas las columnas parseadas existen en los resultados
      const firstRecord = results.records[0] as Record<string, unknown>;
      const allColumnsExist = queryColumns.every(col => {
        const keys = col.split('.');
        let current: any = firstRecord;
        for (const key of keys) {
          if (current && typeof current === 'object' && key in current) {
            current = current[key];
          } else {
            return false;
          }
        }
        return true;
      });
      
      if (allColumnsExist && queryColumns.length > 0) {
        return queryColumns;
      }
    }

    // Fallback: usar el orden de las keys del primer registro
    const columnsOrder: string[] = [];
    const seenColumns = new Set<string>();
    
    const flattenKeys = (obj: Record<string, unknown>, prefix = '') => {
      Object.keys(obj).forEach(key => {
        if (key === 'attributes') return;
        
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          flattenKeys(value as Record<string, unknown>, fullKey);
        } else {
          if (!seenColumns.has(fullKey)) {
            seenColumns.add(fullKey);
            columnsOrder.push(fullKey);
          }
        }
      });
    };

    // Procesar primero el primer registro para establecer el orden
    if (results.records[0] && typeof results.records[0] === 'object') {
      flattenKeys(results.records[0]);
    }

    // Luego procesar el resto para incluir columnas que puedan faltar en el primero
    results.records.slice(1).forEach(record => {
      if (record && typeof record === 'object') {
        flattenKeys(record);
      }
    });

    return columnsOrder;
  }, [results, activeTabConfig?.query]);

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

  // Función para aplicar el filtro según el modo seleccionado
  const matchesFilter = (value: unknown, searchText: string): boolean => {
    const displayValue = value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

    // Modos que no requieren texto de búsqueda
    if (filterMode === 'empty') {
      return displayValue.trim() === '';
    }
    if (filterMode === 'notEmpty') {
      return displayValue.trim() !== '';
    }

    if (!searchText.trim()) return true;

    const compareValue = caseSensitive ? displayValue : displayValue.toLowerCase();
    const compareSearch = caseSensitive ? searchText : searchText.toLowerCase();

    switch (filterMode) {
      case 'contains':
        return compareValue.includes(compareSearch);
      
      case 'exact':
        return compareValue === compareSearch;
      
      case 'startsWith':
        return compareValue.startsWith(compareSearch);
      
      case 'endsWith':
        return compareValue.endsWith(compareSearch);
      
      case 'regex':
        try {
          const flags = caseSensitive ? '' : 'i';
          const regex = new RegExp(searchText, flags);
          return regex.test(displayValue);
        } catch {
          return false; // Regex inválido
        }
      
      default:
        return compareValue.includes(compareSearch);
    }
  };

  // Función para aplicar comparación numérica
  const matchesComparison = (value: unknown, searchText: string): boolean => {
    const numValue = typeof value === 'number' ? value : parseFloat(String(value));
    const searchNum = parseFloat(searchText);

    if (isNaN(numValue) || isNaN(searchNum)) {
      return false;
    }

    switch (comparisonOperator) {
      case '=': return numValue === searchNum;
      case '!=': return numValue !== searchNum;
      case '>': return numValue > searchNum;
      case '<': return numValue < searchNum;
      case '>=': return numValue >= searchNum;
      case '<=': return numValue <= searchNum;
      default: return false;
    }
  };

  // Filtrar resultados basados en el texto y columnas seleccionadas
  const filteredResults = useMemo(() => {
    // Si no hay texto y el modo requiere texto, mostrar todo
    if (!filterText.trim() && filterMode !== 'empty' && filterMode !== 'notEmpty') {
      return results?.records || [];
    }

    if (!results?.records) {
      return [];
    }

    const searchText = filterText;
    
    return results.records.filter(record => {
      // Si hay columnas específicas seleccionadas, buscar solo en esas columnas
      if (filterColumns.length > 0) {
        return filterColumns.some(column => {
          const value = getNestedValue(record as Record<string, unknown>, column);
          return matchesFilter(value, searchText);
        });
      }
      
      // Si no hay columnas seleccionadas, buscar en todas las columnas
      return resultColumns.some(column => {
        const value = getNestedValue(record as Record<string, unknown>, column);
        return matchesFilter(value, searchText);
      });
    });
  }, [results, filterText, filterColumns, resultColumns, filterMode, caseSensitive, comparisonOperator]);

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
      useTooling,
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
  }, [activeObjectName, accessToken, connectionAlias, fieldCache, instanceUrl, useTooling]);

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
      useTooling,
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
  }, [relationshipContext.isRelationship, targetObjectName, accessToken, connectionAlias, fieldCache, instanceUrl, useTooling]);

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
      useTooling,
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
  }, [instanceUrl, accessToken, useTooling, objectsCache.length]);

  // Clear object cache when switching between standard and Tooling API
  useEffect(() => {
    setObjectsCache([]);
    setFieldCache({});
  }, [useTooling]);

  // Cerrar dropdown de columnas al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      if (showColumnDropdown && !target.closest('[data-column-filter]')) {
        setShowColumnDropdown(false);
      }
      
      if (showFilterOptions && !target.closest('[data-filter-options]')) {
        setShowFilterOptions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showColumnDropdown, showFilterOptions]);

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

  const copyAsExcel = async () => {
    if (!filteredResults || filteredResults.length === 0) {
      return;
    }

    try {
      // Formato TSV (Tab-Separated Values) que Excel reconoce al pegar
      const headers = resultColumns.join('\t');
      const rows = filteredResults.map(record => 
        resultColumns.map(col => {
          const value = record[col];
          if (value === null || value === undefined) return '';
          return String(value);
        }).join('\t')
      ).join('\n');
      
      const tsvContent = `${headers}\n${rows}`;
      await navigator.clipboard.writeText(tsvContent);
      setCopyNotification(`✓ ${filteredResults.length} registros copiados en formato Excel`);
      setTimeout(() => setCopyNotification(null), 2000);
    } catch (err) {
      setError('Error al copiar datos');
    }
  };

  const copyAsCSV = async () => {
    if (!filteredResults || filteredResults.length === 0) {
      return;
    }

    try {
      const escapeCSV = (value: any): string => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const headers = resultColumns.map(escapeCSV).join(',');
      const rows = filteredResults.map(record =>
        resultColumns.map(col => escapeCSV(record[col])).join(',')
      ).join('\n');
      
      const csvContent = `${headers}\n${rows}`;
      await navigator.clipboard.writeText(csvContent);
      setCopyNotification(`✓ ${filteredResults.length} registros copiados en formato CSV`);
      setTimeout(() => setCopyNotification(null), 2000);
    } catch (err) {
      setError('Error al copiar datos');
    }
  };

  const copyAsJSON = async () => {
    if (!filteredResults || filteredResults.length === 0) {
      return;
    }

    try {
      const jsonContent = JSON.stringify(filteredResults, null, 2);
      await navigator.clipboard.writeText(jsonContent);
      setCopyNotification(`✓ ${filteredResults.length} registros copiados en formato JSON`);
      setTimeout(() => setCopyNotification(null), 2000);
    } catch (err) {
      setError('Error al copiar datos');
    }
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
      
      // Agregar al historial después de ejecución exitosa
      await addToHistory(normalizedQuery);
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
          <div style={{ position: 'relative' }} ref={historyDropdownRef}>
            <button
              onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
              style={{
                backgroundColor: queryHistory.length > 0 ? 'var(--medium-bg)' : '#f3f4f6',
                cursor: queryHistory.length > 0 ? 'pointer' : 'not-allowed'
              }}
              disabled={queryHistory.length === 0}
            >
              Query History {queryHistory.length > 0 && `(${queryHistory.length})`}
            </button>
            {showHistoryDropdown && queryHistory.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                marginTop: '0.25rem',
                backgroundColor: 'var(--medium-bg)',
                border: '1px solid var(--border-color)',
                borderRadius: '4px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: '400px',
                maxWidth: '600px',
                maxHeight: '400px',
                overflowY: 'auto',
                zIndex: 1000,
                padding: '0.5rem'
              }}>
                <div style={{
                  marginBottom: '0.5rem',
                  paddingBottom: '0.5rem',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  <input
                    type="text"
                    placeholder="🔍 Buscar en historial..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      fontSize: '0.75rem',
                      backgroundColor: 'var(--light-bg)',
                      color: 'var(--text-color)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--muted-text)', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{queryHistory.filter(q => q.toLowerCase().includes(historySearch.toLowerCase())).length} de {queryHistory.length} queries</span>
                  <button
                    onClick={() => setShowClearHistoryModal(true)}
                    style={{
                      padding: '0.3rem 0.6rem',
                      fontSize: '0.7rem',
                      backgroundColor: 'var(--danger-red)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Clear All
                  </button>
                </div>
                {queryHistory
                  .filter(q => q.toLowerCase().includes(historySearch.toLowerCase()))
                  .map((query, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '0.5rem',
                        marginBottom: '0.25rem',
                        padding: '0.5rem',
                        backgroundColor: 'transparent',
                        borderRadius: '4px',
                        border: '1px solid var(--border-color)',
                        position: 'relative'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--light-bg)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <div
                        onClick={() => {
                          if (activeTabConfig) {
                            handleQueryChange(activeTabConfig.id, query);
                            setShowHistoryDropdown(false);
                            setHistorySearch('');
                          }
                        }}
                        style={{
                          flex: 1,
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word'
                        }}
                      >
                        {query}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromHistory(query);
                        }}
                        style={{
                          padding: '0.2rem 0.4rem',
                          fontSize: '0.7rem',
                          backgroundColor: 'var(--danger-red)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          flexShrink: 0
                        }}
                        title="Eliminar query"
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
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

      {copyNotification && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'var(--primary-blue)',
          color: 'white',
          padding: '1.5rem 2.5rem',
          borderRadius: '8px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          fontSize: '1rem',
          fontWeight: 'bold',
          zIndex: 10000,
          animation: 'fadeIn 0.2s ease-in'
        }}>
          {copyNotification}
        </div>
      )}

      <div className="export-result-container">
        <div className="result-toolbar">
            <button onClick={copyAsExcel}>Copy (Excel)</button>
            <button onClick={copyAsCSV}>Copy (CSV)</button>
            <button onClick={copyAsJSON}>Copy (JSON)</button>
            <button className="danger-button">Delete Records</button>
            <div data-column-filter style={{ position: 'relative', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="🔍 Filter"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                style={{ width: '150px' }}
              />
              <button
                onClick={() => setShowColumnDropdown(!showColumnDropdown)}
                style={{ 
                  padding: '0.25rem 0.5rem', 
                  fontSize: '0.7rem',
                  backgroundColor: filterColumns.length > 0 ? 'var(--primary-blue)' : 'var(--medium-bg)',
                  color: filterColumns.length > 0 ? 'white' : 'var(--text-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
                title={filterColumns.length > 0 ? `Filtrar por: ${filterColumns.join(', ')}` : 'Seleccionar columnas'}
              >
                📋 {filterColumns.length > 0 ? `(${filterColumns.length})` : ''}
              </button>
              {showColumnDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: '35px',
                  marginTop: '0.25rem',
                  backgroundColor: 'var(--medium-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  maxHeight: '300px',
                  overflowY: 'auto',
                  zIndex: 1000,
                  minWidth: '200px',
                  padding: '0.5rem'
                }}>
                  <div style={{ 
                    marginBottom: '0.5rem', 
                    paddingBottom: '0.5rem', 
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
                      Filtrar por columnas
                    </span>
                    {filterColumns.length > 0 && (
                      <button
                        onClick={() => setFilterColumns([])}
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.2rem 0.4rem',
                          backgroundColor: 'transparent',
                          color: 'var(--primary-blue)',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="🔍 Buscar columna..."
                    value={columnSearch}
                    onChange={(e) => setColumnSearch(e.target.value)}
                    style={{
                      width: 'calc(100% - 0.8rem)',
                      padding: '0.4rem',
                      marginBottom: '0.5rem',
                      fontSize: '0.75rem',
                      backgroundColor: 'var(--light-bg)',
                      color: 'var(--text-color)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      boxSizing: 'border-box'
                    }}
                  />
                  {resultColumns
                    .filter(column => column.toLowerCase().includes(columnSearch.toLowerCase()))
                    .map(column => (
                    <label
                      key={column}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0.4rem',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        backgroundColor: 'transparent',
                        borderRadius: '4px'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--light-bg)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <input
                        type="checkbox"
                        checked={filterColumns.includes(column)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFilterColumns([...filterColumns, column]);
                          } else {
                            setFilterColumns(filterColumns.filter(c => c !== column));
                          }
                        }}
                        style={{ marginRight: '0.5rem' }}
                      />
                      {column}
                    </label>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowFilterOptions(!showFilterOptions)}
                data-filter-options
                style={{ 
                  padding: '0.25rem 0.5rem', 
                  fontSize: '0.7rem',
                  backgroundColor: filterMode !== 'contains' || caseSensitive ? 'var(--primary-blue)' : 'var(--medium-bg)',
                  color: filterMode !== 'contains' || caseSensitive ? 'white' : 'var(--text-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
                title="Opciones de filtrado"
              >
                ⚙️
              </button>
              {showFilterOptions && (
                <div data-filter-options style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '0.25rem',
                  backgroundColor: 'var(--medium-bg)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  minWidth: '200px',
                  padding: '0.5rem'
                }}>
                  <div style={{ 
                    marginBottom: '0.5rem', 
                    paddingBottom: '0.5rem', 
                    borderBottom: '1px solid var(--border-color)',
                    fontSize: '0.75rem',
                    fontWeight: 'bold'
                  }}>
                    Opciones de filtrado
                  </div>
                  
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--muted-text)', marginBottom: '0.25rem' }}>
                      Modo de búsqueda:
                    </div>
                    {[
                      { value: 'contains', label: '🔍 Contains', desc: 'Contiene el texto' },
                      { value: 'exact', label: '🎯 Exact', desc: 'Coincidencia exacta' },
                      { value: 'startsWith', label: '▶️ Starts with', desc: 'Comienza con' },
                      { value: 'endsWith', label: '◀️ Ends with', desc: 'Termina con' },
                      { value: 'regex', label: '📝 Regex', desc: 'Expresión regular' },
                      { value: 'empty', label: '∅ Empty', desc: 'Campo vacío' },
                      { value: 'notEmpty', label: '≠∅ Not empty', desc: 'Campo no vacío' },
                    ].map(mode => (
                      <label
                        key={mode.value}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0.3rem',
                          cursor: 'pointer',
                          fontSize: '0.7rem',
                          backgroundColor: filterMode === mode.value ? 'var(--light-bg)' : 'transparent',
                          borderRadius: '4px',
                          marginBottom: '0.2rem'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--light-bg)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = filterMode === mode.value ? 'var(--light-bg)' : 'transparent'}
                      >
                        <input
                          type="radio"
                          name="filterMode"
                          checked={filterMode === mode.value}
                          onChange={() => setFilterMode(mode.value as any)}
                          style={{ marginRight: '0.5rem' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div>{mode.label}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--muted-text)' }}>{mode.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div style={{ 
                    paddingTop: '0.5rem', 
                    borderTop: '1px solid var(--border-color)'
                  }}>
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0.3rem',
                        cursor: 'pointer',
                        fontSize: '0.7rem',
                        backgroundColor: 'transparent',
                        borderRadius: '4px'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--light-bg)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <input
                        type="checkbox"
                        checked={caseSensitive}
                        onChange={(e) => setCaseSensitive(e.target.checked)}
                        style={{ marginRight: '0.5rem' }}
                      />
                      <div>
                        <div>Aa Case sensitive</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--muted-text)' }}>Sensible a mayúsculas</div>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>
        </div>
        <div className="result-status">
            <span>
              {resultStatus}
              {filterText && results?.records?.length ? 
                ` (Mostrando ${filteredResults.length} de ${results.records.length})` : 
                ''
              }
            </span>
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
                {filteredResults.map((record, rowIndex) => (
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

      {/* Modal de confirmación para limpiar historial */}
      {showClearHistoryModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: 'var(--medium-bg)',
            padding: '2rem',
            borderRadius: '8px',
            maxWidth: '400px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)'
          }}>
            <h3 style={{ marginTop: 0, color: 'var(--text-color)' }}>Confirmar eliminación</h3>
            <p style={{ color: 'var(--text-color)' }}>
              ¿Estás seguro de que deseas eliminar todas las {queryHistory.length} queries del historial?
              Esta acción no se puede deshacer.
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button
                onClick={() => setShowClearHistoryModal(false)}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: 'var(--medium-bg)',
                  color: 'var(--text-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancelar
              </button>
              <button
                onClick={clearHistory}
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: 'var(--danger-red)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Eliminar Todo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueryTabs;
