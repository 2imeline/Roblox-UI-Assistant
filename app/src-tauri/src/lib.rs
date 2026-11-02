use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// A .rblxui file the OS asked us to open (double-click / "Open with"), waiting for the frontend.
#[derive(Default)]
struct Opened(Mutex<Option<PathBuf>>);

fn rblxui_arg<I: IntoIterator<Item = String>>(args: I) -> Option<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("rblxui")) && p.is_file())
}

fn queue_open(app: &tauri::AppHandle, path: PathBuf) {
    *app.state::<Opened>().0.lock().unwrap() = Some(path);
    let _ = app.emit("file-opened", ());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    // Write to a sibling temp file first so a failed save never truncates the user's file.
    let target = PathBuf::from(&path);
    let tmp = target.with_extension("rblxui-tmp");
    std::fs::write(&tmp, contents).map_err(|e| format!("{path}: {e}"))?;
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{path}: {e}")
    })
}

#[tauri::command]
fn take_opened_file(state: tauri::State<Opened>) -> Option<(String, String)> {
    let path = state.0.lock().unwrap().take()?;
    let text = std::fs::read_to_string(&path).ok()?;
    Some((path.to_string_lossy().into_owned(), text))
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            match rblxui_arg(args) {
                Some(path) => queue_open(app, path),
                None => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.set_focus();
                    }
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Opened(Mutex::new(rblxui_arg(std::env::args()))))
        .invoke_handler(tauri::generate_handler![read_text, write_text, take_opened_file])
        .build(tauri::generate_context!())
        .expect("error while building the Roblox UI Builder");

    app.run(|_app, _event| {
        // macOS delivers "Open with" files as events instead of arguments.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            if let Some(path) = urls.into_iter().filter_map(|u| u.to_file_path().ok()).find(|p| p.is_file()) {
                queue_open(_app, path);
            }
        }
    });
}
