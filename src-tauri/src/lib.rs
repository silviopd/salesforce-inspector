use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Command;
use tauri::{Emitter, menu::{Menu, MenuItem, PredefinedMenuItem, Submenu}};
use tauri_plugin_store::StoreExt;

const API_VERSION: &str = "v58.0";
const MAX_HISTORY_SIZE: usize = 50;

#[derive(Debug, Serialize, Deserialize)]
struct SalesforceAuthResponse {
    access_token: String,
    instance_url: String,
    username: String,
    alias: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SalesforceQueryResult {
    done: bool,
    total_size: u32,
    records: Vec<Value>,
    next_records_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SalesforceFieldDefinition {
    name: String,
    label: Option<String>,
    #[serde(rename = "type")]
    field_type: Option<String>,
    relationship_name: Option<String>,
    reference_to: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SalesforceDescribeResult {
    fields: Vec<SalesforceFieldDefinition>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SalesforceObject {
    name: String,
    label: String,
    label_plural: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SalesforceObjectsResult {
    sobjects: Vec<SalesforceObject>,
}

#[tauri::command]
fn get_query_history(
    org_identifier: String,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    println!("get_query_history called for org: {}", org_identifier);
    
    let store = app.store("store.json")
        .map_err(|e| {
            println!("Error accessing store: {}", e);
            format!("Error al acceder al store: {}", e)
        })?;
    
    // Extraer el dominio único de la org del instanceUrl
    let org_key = org_identifier
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or(&org_identifier)
        .to_string();
    
    let key = format!("query_history_{}", org_key);
    println!("Looking for key: {}", key);
    
    let history: Vec<String> = store.get(&key)
        .and_then(|v| {
            println!("Found value: {:?}", v);
            serde_json::from_value(v.clone()).ok()
        })
        .unwrap_or_else(|| {
            println!("No history found, returning empty vec");
            vec![]
        });
    
    println!("Returning {} queries", history.len());
    Ok(history)
}

#[tauri::command]
fn add_to_query_history(
    org_identifier: String,
    query: String,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    println!("add_to_query_history called - org: {}, query: {}", org_identifier, query);
    
    let store = app.store("store.json")
        .map_err(|e| format!("Error al acceder al store: {}", e))?;
    
    // Extraer el dominio único de la org del instanceUrl
    let org_key = org_identifier
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or(&org_identifier)
        .to_string();
    
    let key = format!("query_history_{}", org_key);
    println!("Using key: {}", key);
    
    let mut queries: Vec<String> = store.get(&key)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    
    println!("Current history length: {}", queries.len());
    
    // Evitar duplicados - si ya existe, moverlo al inicio
    queries.retain(|q| q != &query);
    
    // Insertar al inicio
    queries.insert(0, query);
    
    // Limitar a MAX_HISTORY_SIZE
    if queries.len() > MAX_HISTORY_SIZE {
        queries.truncate(MAX_HISTORY_SIZE);
    }
    
    println!("New history length: {}", queries.len());
    
    // Guardar en el store
    store.set(&key, serde_json::to_value(&queries).unwrap());
    store.save().map_err(|e| format!("Error al guardar: {}", e))?;
    
    println!("History saved successfully");
    
    Ok(queries)
}

#[tauri::command]
fn remove_from_query_history(
    org_identifier: String,
    query: String,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let store = app.store("store.json")
        .map_err(|e| format!("Error al acceder al store: {}", e))?;
    
    let org_key = org_identifier
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or(&org_identifier)
        .to_string();
    
    let key = format!("query_history_{}", org_key);
    
    let mut queries: Vec<String> = store.get(&key)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    
    queries.retain(|q| q != &query);
    
    store.set(&key, serde_json::to_value(&queries).unwrap());
    store.save().map_err(|e| format!("Error al guardar: {}", e))?;
    
    Ok(queries)
}

#[tauri::command]
fn clear_query_history(
    org_identifier: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let store = app.store("store.json")
        .map_err(|e| format!("Error al acceder al store: {}", e))?;
    
    let org_key = org_identifier
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or(&org_identifier)
        .to_string();
    
    let key = format!("query_history_{}", org_key);
    
    store.set(&key, serde_json::to_value::<Vec<String>>(vec![]).unwrap());
    store.save().map_err(|e| format!("Error al guardar: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn get_saved_queries(
    org_identifier: String,
    app: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    let store = app.store("store.json")
        .map_err(|e| format!("Error al acceder al store: {}", e))?;
    
    let org_key = org_identifier
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or(&org_identifier)
        .to_string();
    
    let key = format!("saved_queries_{}", org_key);
    
    let saved: std::collections::HashMap<String, String> = store.get(&key)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    
    Ok(saved)
}

#[tauri::command]
fn save_query(
    org_identifier: String,
    label: String,
    query: String,
    app: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    let store = app.store("store.json")
        .map_err(|e| format!("Error al acceder al store: {}", e))?;
    
    let org_key = org_identifier
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or(&org_identifier)
        .to_string();
    
    let key = format!("saved_queries_{}", org_key);
    
    let mut saved: std::collections::HashMap<String, String> = store.get(&key)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    
    saved.insert(label, query);
    
    store.set(&key, serde_json::to_value(&saved).unwrap());
    store.save().map_err(|e| format!("Error al guardar: {}", e))?;
    
    Ok(saved)
}

#[tauri::command]
fn delete_saved_query(
    org_identifier: String,
    label: String,
    app: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    let store = app.store("store.json")
        .map_err(|e| format!("Error al acceder al store: {}", e))?;
    
    let org_key = org_identifier
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or(&org_identifier)
        .to_string();
    
    let key = format!("saved_queries_{}", org_key);
    
    let mut saved: std::collections::HashMap<String, String> = store.get(&key)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    
    saved.remove(&label);
    
    store.set(&key, serde_json::to_value(&saved).unwrap());
    store.save().map_err(|e| format!("Error al guardar: {}", e))?;
    
    Ok(saved)
}

#[tauri::command]
fn cleanup_auth_port() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("sh")
            .args(["-c", "lsof -ti :1717 | xargs kill -9 2>/dev/null || true"])
            .output()
            .map_err(|e| format!("Error al ejecutar comando: {}", e))?;
        
        if output.status.success() {
            Ok("Puerto limpiado".to_string())
        } else {
            Ok("Puerto no estaba en uso".to_string())
        }
    }
    
    #[cfg(not(target_os = "macos"))]
    {
        Ok("Limpieza de puerto no implementada para este sistema".to_string())
    }
}

#[tauri::command]
async fn salesforce_login(
    alias: String,
    instance_url: String,
) -> Result<SalesforceAuthResponse, String> {
    // Ejecutar el comando sf org login web
    let output = Command::new("sf")
        .args([
            "org",
            "login",
            "web",
            "--alias",
            &alias,
            "--instance-url",
            &instance_url,
            "--json",
        ])
        .output()
        .map_err(|e| format!("Error al ejecutar comando sf: {}", e))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        
        // Si stdout y stderr están vacíos, probablemente el usuario canceló
        if stdout.trim().is_empty() && stderr.trim().is_empty() {
            return Err("Login cancelado por el usuario".to_string());
        }
        
        println!("Login failed - stdout: {}", stdout);
        println!("Login failed - stderr: {}", stderr);
        return Err(format!("Error en el login: stdout={}, stderr={}", stdout, stderr));
    }

    // Ahora obtener el access token
    let token_output = Command::new("sf")
        .args(["org", "display", "--target-org", &alias, "--json"])
        .output()
        .map_err(|e| format!("Error al obtener token: {}", e))?;

    if !token_output.status.success() {
        let error = String::from_utf8_lossy(&token_output.stderr);
        return Err(format!("Error al obtener información de la org: {}", error));
    }

    let token_stdout = String::from_utf8_lossy(&token_output.stdout);
    let org_info: serde_json::Value =
        serde_json::from_str(&token_stdout).map_err(|e| format!("Error al parsear JSON: {}", e))?;

    let result = org_info["result"]
        .as_object()
        .ok_or("No se encontró el objeto result")?;

    let access_token = result["accessToken"]
        .as_str()
        .ok_or("No se encontró el access token")?;
    let username = result["username"]
        .as_str()
        .ok_or("No se encontró el username")?;
    let instance = result["instanceUrl"]
        .as_str()
        .ok_or("No se encontró la instance URL")?;

    Ok(SalesforceAuthResponse {
        access_token: access_token.to_string(),
        instance_url: instance.to_string(),
        username: username.to_string(),
        alias: alias.clone(),
    })
}

#[tauri::command]
async fn salesforce_logout(alias: String) -> Result<String, String> {
    let output = Command::new("sf")
        .args(["org", "logout", "--target-org", &alias, "--no-prompt"])
        .output()
        .map_err(|e| format!("Error al ejecutar logout: {}", e))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Error en el logout: {}", error));
    }

    Ok(format!("Logout exitoso de {}", alias))
}

#[tauri::command]
async fn run_soql_query(
    instance_url: String,
    access_token: String,
    query: String,
    use_tooling: bool,
    include_deleted: bool,
) -> Result<SalesforceQueryResult, String> {
    let client = reqwest::Client::new();
    
    let final_query = query.trim().trim_end_matches(';').to_string();
    
    // Usar queryAll si include_deleted está activo (para incluir registros eliminados/archivados)
    let endpoint = if use_tooling {
        format!("/services/data/{}/tooling/query", API_VERSION)
    } else if include_deleted {
        println!("Usando queryAll para incluir registros eliminados");
        format!("/services/data/{}/queryAll", API_VERSION)
    } else {
        format!("/services/data/{}/query", API_VERSION)
    };

    let url = format!("{}{}", instance_url.trim_end_matches('/'), endpoint);

    let response = client
        .get(&url)
        .bearer_auth(&access_token)
        .query(&[("q", final_query)])
        .send()
        .await
        .map_err(|e| format!("Error al ejecutar SOQL: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Error al leer respuesta: {}", e))?;

    if !status.is_success() {
        return Err(format!("Error de Salesforce ({}): {}", status, body));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Error al parsear respuesta de Salesforce: {}", e))?;

    let done = value.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
    let total_size = value.get("totalSize").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let next_records_url = value
        .get("nextRecordsUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let records = match value.get("records") {
        Some(Value::Array(items)) => items.clone(),
        _ => Vec::new(),
    };

    Ok(SalesforceQueryResult {
        done,
        total_size,
        records,
        next_records_url,
    })
}

#[tauri::command]
async fn describe_sobject(
    instance_url: String,
    access_token: String,
    object_name: String,
    use_tooling: Option<bool>,
) -> Result<SalesforceDescribeResult, String> {
    let client = reqwest::Client::new();
    let trimmed_object = object_name.trim();

    if trimmed_object.is_empty() {
        return Err("El nombre del objeto es requerido".to_string());
    }

    let endpoint = if use_tooling.unwrap_or(false) {
        "/tooling/sobjects"
    } else {
        "/sobjects"
    };

    let url = format!(
        "{}/services/data/{}{}/{}/describe",
        instance_url.trim_end_matches('/'),
        API_VERSION,
        endpoint,
        trimmed_object
    );

    let response = client
        .get(&url)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Error al obtener describe: {}", e))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Error al leer respuesta: {}", e))?;

    if !status.is_success() {
        return Err(format!("Error de Salesforce ({}): {}", status, body));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Error al parsear describe de Salesforce: {}", e))?;

    let fields = value
        .get("fields")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name")?.as_str()?;
                    Some(SalesforceFieldDefinition {
                        name: name.to_string(),
                        label: item
                            .get("label")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        field_type: item
                            .get("type")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        relationship_name: item
                            .get("relationshipName")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        reference_to: item
                            .get("referenceTo")
                            .and_then(|v| v.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                    .collect::<Vec<_>>()
                            }),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(SalesforceDescribeResult { fields })
}

#[tauri::command]
async fn list_sobjects(
    instance_url: String,
    access_token: String,
    use_tooling: Option<bool>,
) -> Result<SalesforceObjectsResult, String> {
    let client = reqwest::Client::new();

    println!("list_sobjects called with instance_url: {}", instance_url);
    println!("access_token length: {}", access_token.len());

    let endpoint = if use_tooling.unwrap_or(false) {
        "/tooling/sobjects"
    } else {
        "/sobjects"
    };

    let url = format!(
        "{}/services/data/{}{}",
        instance_url.trim_end_matches('/'),
        API_VERSION,
        endpoint
    );

    println!("Fetching sobjects from: {}", url);

    let response = client
        .get(&url)
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|e| format!("Error al obtener objetos: {}", e))?;

    let status = response.status();
    
    println!("Response status: {}", status);
    
    let body = response
        .text()
        .await
        .map_err(|e| format!("Error al leer respuesta: {}", e))?;

    println!("Response body (first 200 chars): {}", &body.chars().take(200).collect::<String>());

    if !status.is_success() {
        println!("Error response body: {}", body);
        return Err(format!("Error de Salesforce ({}): {}", status, body));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|e| format!("Error al parsear lista de objetos: {}", e))?;

    let sobjects = value
        .get("sobjects")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name")?.as_str()?;
                    let label = item.get("label")?.as_str()?;
                    Some(SalesforceObject {
                        name: name.to_string(),
                        label: label.to_string(),
                        label_plural: item
                            .get("labelPlural")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(SalesforceObjectsResult { sobjects })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // Crear menú
            let toggle_connection_tabs = MenuItem::with_id(app, "toggle_connection_tabs", "Toggle Connection Tabs", true, None::<&str>)?;
            let toggle_sub_tabs = MenuItem::with_id(app, "toggle_sub_tabs", "Toggle Sub Tabs", true, None::<&str>)?;
            let toggle_theme = MenuItem::with_id(app, "toggle_theme", "Toggle Dark/Light Mode", true, None::<&str>)?;
            
            let view_menu = Submenu::with_items(
                app,
                "View",
                true,
                &[
                    &toggle_connection_tabs,
                    &toggle_sub_tabs,
                    &PredefinedMenuItem::separator(app)?,
                    &toggle_theme,
                ]
            )?;
            
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ]
            )?;
            
            let menu = Menu::with_items(
                app,
                &[
                    #[cfg(target_os = "macos")]
                    &Submenu::with_items(
                        app,
                        "Salesforce Inspector",
                        true,
                        &[
                            &PredefinedMenuItem::about(app, None, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::services(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::hide(app, None)?,
                            &PredefinedMenuItem::hide_others(app, None)?,
                            &PredefinedMenuItem::show_all(app, None)?,
                            &PredefinedMenuItem::separator(app)?,
                            &PredefinedMenuItem::quit(app, None)?,
                        ]
                    )?,
                    &edit_menu,
                    &view_menu,
                ]
            )?;
            
            app.set_menu(menu)?;
            
            // Manejar eventos del menú
            app.on_menu_event(|app, event| {
                match event.id().as_ref() {
                    "toggle_connection_tabs" => {
                        let _ = app.emit("toggle-connection-tabs", ());
                    }
                    "toggle_sub_tabs" => {
                        let _ = app.emit("toggle-sub-tabs", ());
                    }
                    "toggle_theme" => {
                        let _ = app.emit("toggle-theme", ());
                    }
                    _ => {}
                }
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            salesforce_login,
            salesforce_logout,
            run_soql_query,
            describe_sobject,
            list_sobjects,
            get_query_history,
            add_to_query_history,
            remove_from_query_history,
            clear_query_history,
            get_saved_queries,
            save_query,
            delete_saved_query,
            cleanup_auth_port
        ])
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
