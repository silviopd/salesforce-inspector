use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Command;

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
        let error = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Error en el login: {}", error));
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
    const API_VERSION: &str = "v58.0";

    let client = reqwest::Client::new();
    let endpoint = if use_tooling {
        format!("/services/data/{}/tooling/query", API_VERSION)
    } else {
        format!("/services/data/{}/query", API_VERSION)
    };

    let mut final_query = query.trim().trim_end_matches(';').to_string();
    if include_deleted && !final_query.to_lowercase().contains(" all rows") {
        final_query.push_str(" ALL ROWS");
    }

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            salesforce_login,
            salesforce_logout,
            run_soql_query
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
