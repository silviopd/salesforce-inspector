import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import "./App.css";

interface SalesforceAuthResponse {
  access_token: string;
  instance_url: string;
  username: string;
  alias: string;
}

type SubTab = 'queries' | 'users' | 'info';

const store = new Store("auth.json");

function App() {
  const [connections, setConnections] = useState<SalesforceAuthResponse[]>([]);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [connectionSubTabs, setConnectionSubTabs] = useState<Record<string, SubTab>>({});
  const [pendingActiveAlias, setPendingActiveAlias] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("https://login.salesforce.com");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Cargar conexiones guardadas al iniciar
  useEffect(() => {
    loadSavedConnections();
  }, []);

  async function loadSavedConnections() {
    try {
      const saved = await store.get<SalesforceAuthResponse[]>("connections");
      const savedSubTabs = await store.get<Record<string, SubTab>>("subTabs");

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
    await store.set("connections", conns);
    await store.set("subTabs", subTabs);
    await store.save();
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

    setIsLoading(true);
    setError("");

    try {
      const response = await invoke<SalesforceAuthResponse>("salesforce_login", {
        alias,
        instanceUrl,
      });

      const newConnections = [...connections, response];
      const newSubTabs = { ...connectionSubTabs, [response.alias]: 'queries' };

      setConnections(newConnections);
      setConnectionSubTabs(newSubTabs);
      setActiveTab(newConnections.length - 1);
      await persistState(newConnections, newSubTabs);
      setPendingActiveAlias(response.alias);
      setAlias("");
      setError("");
      console.log("Login exitoso:", response);
    } catch (err) {
      setError(`Error de autenticación: ${err}`);
      console.error("Error:", err);
    } finally {
      setIsLoading(false);
    }
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
      {connections.length > 0 && (
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
              required
            />
          </div>

          {error && (
            <div className="result error">
              <p>{error}</p>
            </div>
          )}

          <button type="submit" disabled={isLoading} className="login-button">
            {isLoading ? "Conectando..." : "Conectar con Salesforce"}
          </button>
        </form>
      ) : activeConnection ? (
        <div className="connection-details">
          {/* Sub-tabs */}
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
                  
                  <p><strong>Access Token:</strong></p>
                  <div className="code-block">{activeConnection.access_token}</div>
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

            {currentSubTab === 'queries' && (
              <div className="queries-section">
                <h3>SOQL Queries</h3>
                <p>Aquí podrás ejecutar queries SOQL contra Salesforce</p>
                {/* TODO: Implementar editor de queries */}
              </div>
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
