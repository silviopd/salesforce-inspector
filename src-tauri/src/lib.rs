use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
struct SalesforceAuthResponse {
    access_token: String,
    instance_url: String,
    username: String,
    alias: String,
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

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // Ahora obtener el access token
    let token_output = Command::new("sf")
        .args([
            "org",
            "display",
            "--target-org",
            &alias,
            "--json",
        ])
        .output()
        .map_err(|e| format!("Error al obtener token: {}", e))?;

    if !token_output.status.success() {
        let error = String::from_utf8_lossy(&token_output.stderr);
        return Err(format!("Error al obtener información de la org: {}", error));
    }

    let token_stdout = String::from_utf8_lossy(&token_output.stdout);
    let org_info: serde_json::Value = serde_json::from_str(&token_stdout)
        .map_err(|e| format!("Error al parsear JSON: {}", e))?;

    let result = org_info["result"].as_object()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![salesforce_login, salesforce_logout])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
