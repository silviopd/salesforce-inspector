import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Store } from "@tauri-apps/plugin-store";
import QueryTabs from "./components/QueryTabs";
import "./App.css";
import "./components/QueryTabs.css";

interface SalesforceAuthResponse {
  access_token: string;
  instance_url: string;
  username: string;
  alias: string;
}

type SubTab = 'queries' | 'users' | 'info';

let store: Store | null = null;

async function getStore() {
  if (!store) {
    store = await Store.load("auth.json");
  }
  return store;
}

function App() {
  const [connections, setConnections] = useState<SalesforceAuthResponse[]>([]);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [connectionSubTabs, setConnectionSubTabs] = useState<Record<string, SubTab>>({});
  const [pendingActiveAlias, setPendingActiveAlias] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("https://login.salesforce.com");
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [loginAborted, setLoginAborted] = useState(false);
  const [error, setError] = useState("");
  const [showConnectionTabs, setShowConnectionTabs] = useState(true);
  const [showSubTabs, setShowSubTabs] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Cargar conexiones guardadas al iniciar
  useEffect(() => {
    loadSavedConnections();
    loadThemePreference();
    
    // Escuchar eventos del menú
    const unlistenConnectionTabs = listen('toggle-connection-tabs', () => {
      setShowConnectionTabs(prev => !prev);
    });
    
    const unlistenSubTabs = listen('toggle-sub-tabs', () => {
      setShowSubTabs(prev => !prev);
    });

    const unlistenTheme = listen('toggle-theme', () => {
      setIsDarkMode(prev => {
        const newValue = !prev;
        saveThemePreference(newValue);
        return newValue;
      });
    });
    
    return () => {
      unlistenConnectionTabs.then(fn => fn());
      unlistenSubTabs.then(fn => fn());
      unlistenTheme.then(fn => fn());
    };
  }, []);

  // Aplicar tema
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [isDarkMode]);

  async function loadThemePreference() {
    try {
      const s = await getStore();
      const saved = await s.get<boolean>("isDarkMode");
      if (saved !== null && saved !== undefined) {
        setIsDarkMode(saved);
      }
    } catch (err) {
      console.log("No hay preferencia de tema guardada");
    }
  }

  async function saveThemePreference(isDark: boolean) {
    const s = await getStore();
    await s.set("isDarkMode", isDark);
    await s.save();
  }

  async function loadSavedConnections() {
    try {
      const s = await getStore();
      const saved = await s.get<SalesforceAuthResponse[]>("connections");
      const savedSubTabs = await s.get<Record<string, SubTab>>("subTabs");

      if (saved && saved.length > 0) {
        setConnections(saved);

        const mergedTabs = saved.reduce<Record<string, SubTab>>((acc, conn) => {
          acc[conn.alias] = savedSubTabs?.[conn.alias] ?? 'queries';
          return acc;
        }, {});

        setConnectionSubTabs(mergedTabs);
      }
    } catch (err) {
      console.log("No hay conexiones guardadas");
    }
  }

  async function persistState(
    conns: SalesforceAuthResponse[],
    subTabs: Record<string, SubTab>
  ) {
    const s = await getStore();
    await s.set("connections", conns);
    await s.set("subTabs", subTabs);
    await s.save();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    
    if (!alias.trim()) {
      setError("Por favor ingresa un alias");
      return;
    }

    // Verificar si el alias ya existe
    if (connections.some(conn => conn.alias === alias)) {
      setError(`Ya existe una conexión con el alias "${alias}"`);
      return;
    }

    // Limpiar puerto antes de intentar conectar
    try {
      await invoke('cleanup_auth_port');
    } catch (err) {
      console.log('Puerto ya estaba limpio');
    }

    setIsLoading(true);
    setIsConnecting(true);
    setLoginAborted(false);
    setError("");

    try {
      const response = await invoke<SalesforceAuthResponse>("salesforce_login", {
        alias,
        instanceUrl,
      });

      // Si se canceló mientras esperábamos la respuesta, ignorar el resultado
      if (loginAborted) {
        console.log("Login cancelado después de respuesta");
        return;
      }

      const newConnections = [...connections, response];
      const newSubTabs = { ...connectionSubTabs, [response.alias]: 'queries' };

      setConnections(newConnections);
      setConnectionSubTabs(newSubTabs);
      setActiveTab(newConnections.length - 1);
      await persistState(newConnections, newSubTabs);
      setPendingActiveAlias(response.alias);
      setAlias("");
      setError("");
      setLoginAborted(false);
      console.log("Login exitoso:", response);
    } catch (err) {
      // Si se canceló, no mostrar error
      if (loginAborted) {
        console.log("Error ignorado porque se canceló");
        return;
      }
      
      const errorMessage = String(err);
      
      // Ignorar errores de cancelación
      if (errorMessage.includes("Login cancelado por el usuario") || 
          errorMessage.includes("PortInUseError")) {
        console.log("Login cancelado");
        return;
      }
      
      setError(`Error de autenticación: ${err}`);
      console.error("Error:", err);
    } finally {
      if (!loginAborted) {
        setIsLoading(false);
        setIsConnecting(false);
      }
    }
  }

  async function handleCancelLogin() {
    console.log("Cancelando login...");
    setLoginAborted(true);
    
    // Cancelar el proceso de login en el backend
    try {
      await invoke('cancel_login', { alias });
      console.log("Proceso de login cancelado");
    } catch (err) {
      console.log('Error al cancelar login:', err);
    }
    
    // Intentar matar el proceso del puerto 1717 si quedó abierto
    try {
      await invoke('cleanup_auth_port');
      console.log("Puerto limpiado después de cancelar");
    } catch (err) {
      console.log('No se pudo limpiar el puerto:', err);
    }
    
    setIsConnecting(false);
    setIsLoading(false);
    setError("");
    
    // Resetear loginAborted después de un momento para permitir nueva conexión
    setTimeout(() => {
      setLoginAborted(false);
      console.log("LoginAborted reseteado");
    }, 500);
  }

  async function handleLogout(index: number) {
    const connection = connections[index];
    if (!connection) return;

    try {
      await invoke("salesforce_logout", { alias: connection.alias });
      const newConnections = connections.filter((_, i) => i !== index);
      const { [connection.alias]: _, ...remainingSubTabs } = connectionSubTabs;

      setConnections(newConnections);
      setConnectionSubTabs(remainingSubTabs);
      await persistState(newConnections, remainingSubTabs);
      if (pendingActiveAlias === connection.alias) {
        setPendingActiveAlias(null);
      }
      
      // Ajustar el tab activo
      if (activeTab >= newConnections.length && newConnections.length > 0) {
        setActiveTab(newConnections.length - 1);
      } else if (newConnections.length === 0) {
        setActiveTab(0);
      }
      
      setError("");
    } catch (err) {
      console.error("Error al hacer logout:", err);
      setError(`Error al cerrar sesión: ${err}`);
    }
  }

  async function handleSubTabChange(alias: string, tab: SubTab) {
    const updatedSubTabs = { ...connectionSubTabs, [alias]: tab };
    setConnectionSubTabs(updatedSubTabs);

    try {
      await persistState(connections, updatedSubTabs);
    } catch (err) {
      console.error("Error al guardar la pestaña activa:", err);
    }
  }

  const activeConnection = connections[activeTab];
  const currentSubTab = activeConnection
    ? connectionSubTabs[activeConnection.alias] ?? 'queries'
    : 'queries';

  useEffect(() => {
    if (!pendingActiveAlias) {
      return;
    }

    const index = connections.findIndex(conn => conn.alias === pendingActiveAlias);
    if (index !== -1) {
      setActiveTab(index);
      setPendingActiveAlias(null);
    }
  }, [connections, pendingActiveAlias]);

  return (
    <main className="container">
      {/* Tabs */}
      {connections.length > 0 && showConnectionTabs && (
        <div className="tabs">
          {connections.map((conn, index) => (
            <button
              key={conn.alias}
              className={`tab ${activeTab === index ? 'active' : ''}`}
              onClick={() => {
                setActiveTab(index);
                setError("");
              }}
            >
              {conn.alias}
              <span 
                className="close-tab"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLogout(index);
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button
            className="tab new-tab"
            onClick={() => {
              setActiveTab(-1);
              setAlias("");
              setInstanceUrl("https://login.salesforce.com");
              setError("");
              setPendingActiveAlias(null);
            }}
          >
            + Nueva Conexión
          </button>
        </div>
      )}

      {/* Contenido del tab activo */}
      {activeTab === -1 || connections.length === 0 ? (
        <form className="login-form" onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="instance-url">Instance URL</label>
            <select
              id="instance-url"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              disabled={isConnecting}
              required
            >
              <option value="https://login.salesforce.com">Producción</option>
              <option value="https://test.salesforce.com">Sandbox</option>
            </select>
            <small>Se abrirá una ventana del navegador para autenticarte</small>
          </div>

          <div className="form-group">
            <label htmlFor="alias">Alias (nombre para esta conexión)</label>
            <input
              id="alias"
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="Ej: production, sandbox-dev, qa"
              disabled={isConnecting}
              required
            />
          </div>

          {error && (
            <div className="result error">
              <p>{error}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={isLoading || isConnecting} className="login-button">
              {isLoading ? "Conectando..." : "Conectar con Salesforce"}
            </button>
            {isConnecting && (
              <button 
                type="button" 
                onClick={handleCancelLogin}
                className="cancel-button"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      ) : activeConnection ? (
        <div className="connection-details">
          {/* Sub-tabs */}
          {showSubTabs && (
            <div className="sub-tabs">
              <button
                className={`sub-tab ${currentSubTab === 'info' ? 'active' : ''}`}
                onClick={() => activeConnection && handleSubTabChange(activeConnection.alias, 'info')}
              >
                Información
              </button>
              <button
                className={`sub-tab ${currentSubTab === 'queries' ? 'active' : ''}`}
                onClick={() => activeConnection && handleSubTabChange(activeConnection.alias, 'queries')}
              >
                Queries
              </button>
              <button
                className={`sub-tab ${currentSubTab === 'users' ? 'active' : ''}`}
                onClick={() => activeConnection && handleSubTabChange(activeConnection.alias, 'users')}
              >
                Users
              </button>
            </div>
          )}

          {/* Contenido del sub-tab */}
          <div className="sub-tab-content">
            {currentSubTab === 'info' && (
              <div className="result success">
                <h3>✅ Conexión Activa</h3>
                <div className="result-details">
                  <p><strong>Alias:</strong> {activeConnection.alias}</p>
                  <p><strong>Username:</strong> {activeConnection.username}</p>
                  
                  <p><strong>Instance URL:</strong></p>
                  <div className="code-block">{activeConnection.instance_url}</div>
                </div>
                <button 
                  onClick={() => handleLogout(activeTab)} 
                  className="login-button danger"
                  style={{ marginTop: "20px" }}
                >
                  Cerrar Sesión
                </button>
              </div>
            )}

            {currentSubTab === 'queries' && activeConnection && (
              <QueryTabs
                key={activeConnection.alias}
                instanceUrl={activeConnection.instance_url}
                accessToken={activeConnection.access_token}
                connectionAlias={activeConnection.alias}
              />
            )}

            {currentSubTab === 'users' && (
              <div className="users-section">
                <h3>Usuarios</h3>
                <p>Aquí podrás gestionar usuarios de Salesforce</p>
                {/* TODO: Implementar gestión de usuarios */}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default App;
