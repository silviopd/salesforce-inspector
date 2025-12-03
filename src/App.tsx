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

const store = new Store("auth.json");

function App() {
  const [alias, setAlias] = useState("myorg");
  const [instanceUrl, setInstanceUrl] = useState("https://login.salesforce.com");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [authData, setAuthData] = useState<SalesforceAuthResponse | null>(null);

  // Cargar datos guardados al iniciar
  useEffect(() => {
    loadSavedAuth();
  }, []);

  async function loadSavedAuth() {
    try {
      const saved = await store.get<SalesforceAuthResponse>("authData");
      if (saved) {
        setAuthData(saved);
      }
    } catch (err) {
      console.log("No hay datos guardados");
    }
  }

  async function saveAuthData(data: SalesforceAuthResponse) {
    await store.set("authData", data);
    await store.save();
  }

  async function clearAuthData() {
    await store.delete("authData");
    await store.save();
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setAuthData(null);

    try {
      const response = await invoke<SalesforceAuthResponse>("salesforce_login", {
        alias,
        instanceUrl,
      });

      setAuthData(response);
      await saveAuthData(response);
      console.log("Login exitoso:", response);
    } catch (err) {
      setError(`Error de autenticación: ${err}`);
      console.error("Error:", err);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    if (!authData) return;

    try {
      await invoke("salesforce_logout", { alias: authData.alias });
      await clearAuthData();
      setAuthData(null);
      setError("");
    } catch (err) {
      console.error("Error al hacer logout:", err);
    }
  }

  return (
    <main className="container">
      <h1>Salesforce Inspector</h1>
      <p className="subtitle">Conecta con tu org usando Salesforce CLI</p>

      {!authData ? (
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
              placeholder="myorg"
              required
            />
          </div>

          {error && (
            <div className="result error">
              <p>{error}</p>
            </div>
          )}

          <button type="submit" disabled={isLoading} className="login-button">
            {isLoading ? "Conectando..." : "Login con Salesforce CLI"}
          </button>
        </form>
      ) : (
        <div className="result success">
          <h3>✅ Autenticación exitosa</h3>
          <div className="result-details">
            <p><strong>Alias:</strong> {authData.alias}</p>
            <p><strong>Username:</strong> {authData.username}</p>
            
            <p><strong>Instance URL:</strong></p>
            <div className="code-block">{authData.instance_url}</div>
            
            <p><strong>Access Token:</strong></p>
            <div className="code-block">{authData.access_token}</div>
          </div>
          <button 
            onClick={handleLogout} 
            className="login-button"
            style={{ marginTop: "20px" }}
          >
            Cerrar Sesión
          </button>
        </div>
      )}
    </main>
  );
}

export default App;
