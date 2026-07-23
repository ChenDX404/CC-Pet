use crate::commands::send_pet_message;
use serde_json::{json, Value};
use std::{
    env,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime},
};
use tauri::AppHandle;

const TRANSCRIPT_TAIL_BYTES: u64 = 512 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
enum State {
    Idle,
    Open,
    Working,
}

#[derive(Clone, Debug)]
struct Snapshot {
    state: State,
    prompt: String,
    reply: String,
    transcript: Option<PathBuf>,
}

struct TranscriptSelection {
    has_sessions: bool,
    transcript: Option<PathBuf>,
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(700));
        let mut previous: Option<Snapshot> = None;
        loop {
            let snapshot = inspect();
            publish_changes(&app, previous.as_ref(), &snapshot);
            previous = Some(snapshot);
            thread::sleep(Duration::from_millis(350));
        }
    });
}

fn publish_changes(app: &AppHandle, previous: Option<&Snapshot>, current: &Snapshot) {
    let previous_state = previous.map(|snapshot| &snapshot.state);
    if previous_state != Some(&current.state) {
        let state = state_name(&current.state);
        let prev_state = previous_state.map(state_name).unwrap_or("idle");
        if should_publish_reply(previous, current) {
            let _ = send_pet_message(app, json!({ "type": "cc-reply", "text": current.reply }));
        }
        let _ = send_pet_message(app, json!({
            "type": "cc-state",
            "state": state,
            "prevState": prev_state,
        }));
        if current.state == State::Working {
            let text = if current.prompt.is_empty() { "CC正在处理中…" } else { &current.prompt };
            let _ = send_pet_message(app, json!({ "type": "cc-working-prompt", "text": text }));
        }
        return;
    }

    if current.state == State::Working
        && previous.is_some_and(|snapshot| snapshot.prompt != current.prompt)
    {
        let text = if current.prompt.is_empty() { "CC正在处理中…" } else { &current.prompt };
        let _ = send_pet_message(app, json!({ "type": "cc-working-prompt", "text": text }));
    }
}

fn should_publish_reply(previous: Option<&Snapshot>, current: &Snapshot) -> bool {
    previous.is_some_and(|snapshot| {
        snapshot.state == State::Working
            && current.state == State::Open
            && !current.reply.is_empty()
            && snapshot.transcript.is_some()
            && snapshot.transcript == current.transcript
    })
}

fn inspect() -> Snapshot {
    let Some(home) = home_dir() else { return empty_snapshot(State::Idle) };
    let sessions_directory = home.join(".claude").join("sessions");
    let projects_directory = home.join(".claude").join("projects");
    let selection = select_active_transcript(&sessions_directory, &projects_directory);
    if !selection.has_sessions {
        return empty_snapshot(State::Idle);
    }
    let Some(transcript) = selection.transcript else { return empty_snapshot(State::Open) };
    let Ok(lines) = read_tail_lines(&transcript) else { return empty_snapshot(State::Open) };
    let mut snapshot = analyze_lines(&lines);
    snapshot.transcript = Some(transcript);
    snapshot
}

fn analyze_lines(lines: &[String]) -> Snapshot {
    let mut latest_user_index: Option<usize> = None;
    let mut latest_final_index: Option<usize> = None;
    let mut latest_terminal_index: Option<usize> = None;
    let mut prompt = String::new();
    let mut reply = String::new();

    for (index, line) in lines.iter().enumerate() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        let Some(message) = entry.get("message") else { continue };
        if is_terminal_user_event(&entry, message) {
            latest_terminal_index = Some(index);
            continue;
        }
        let role = message.get("role").and_then(Value::as_str).unwrap_or_default();
        let text = message_text(message);
        if text.is_empty() { continue }
        if role == "user" && entry.get("isMeta").and_then(Value::as_bool) != Some(true) {
            latest_user_index = Some(index);
            prompt = truncate(&normalize_whitespace(&text), 60);
        } else if role == "assistant"
            && message.get("stop_reason").and_then(Value::as_str) == Some("end_turn")
        {
            latest_final_index = Some(index);
            reply = truncate(text.trim(), 80);
        }
    }

    let latest_end = latest_final_index
        .into_iter()
        .chain(latest_terminal_index)
        .max();
    let working = latest_user_index.is_some_and(|user| latest_end.is_none_or(|end| user > end));
    let reply_is_current = latest_final_index.is_some_and(|final_reply| {
        latest_user_index.is_some_and(|user| final_reply > user)
            && latest_terminal_index.is_none_or(|terminal| final_reply > terminal)
    });
    if !reply_is_current {
        reply.clear();
    }
    Snapshot {
        state: if working { State::Working } else { State::Open },
        prompt,
        reply,
        transcript: None,
    }
}

fn select_active_transcript(sessions_directory: &Path, projects_directory: &Path) -> TranscriptSelection {
    let session_ids = fs::read_dir(sessions_directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("json"))
        .filter_map(|entry| {
            let session = serde_json::from_str::<Value>(&fs::read_to_string(entry.path()).ok()?).ok()?;
            if session
                .get("pid")
                .and_then(Value::as_u64)
                .and_then(|pid| u32::try_from(pid).ok())
                .is_some_and(|pid| !is_process_alive(pid))
            {
                return None;
            }
            session
                .get("sessionId")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect::<Vec<_>>();
    if session_ids.is_empty() {
        return TranscriptSelection { has_sessions: false, transcript: None };
    }

    let project_directories = fs::read_dir(projects_directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    let mut candidates = session_ids
        .iter()
        .flat_map(|session_id| {
            project_directories
                .iter()
                .map(move |directory| directory.join(format!("{session_id}.jsonl")))
        })
        .filter_map(|transcript| {
            let modified = transcript
                .metadata()
                .ok()?
                .modified()
                .unwrap_or(SystemTime::UNIX_EPOCH);
            Some((modified, transcript))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    TranscriptSelection {
        has_sessions: true,
        transcript: candidates.into_iter().next().map(|(_, path)| path),
    }
}

fn read_tail_lines(path: &Path) -> Result<Vec<String>, std::io::Error> {
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    let start = length.saturating_sub(TRANSCRIPT_TAIL_BYTES);
    file.seek(SeekFrom::Start(start))?;
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    Ok(content.lines().map(str::to_string).collect())
}

fn message_text(message: &Value) -> String {
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        return text.trim().to_string();
    }
    message
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn is_terminal_user_event(entry: &Value, message: &Value) -> bool {
    if entry.get("toolDenialKind").and_then(Value::as_str) == Some("user-rejected") {
        return true;
    }
    if message.get("role").and_then(Value::as_str) != Some("user") {
        return false;
    }
    message
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .any(|text| {
            matches!(
                text.trim().to_ascii_lowercase().as_str(),
                "[request interrupted by user]" | "[request interrupted by user for tool use]"
            )
        })
}

#[cfg(windows)]
fn is_process_alive(pid: u32) -> bool {
    use std::ffi::c_void;

    type Handle = *mut c_void;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> Handle;
        fn GetExitCodeProcess(process: Handle, exit_code: *mut u32) -> i32;
        fn CloseHandle(object: Handle) -> i32;
    }

    if pid == 0 {
        return false;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut exit_code = 0;
        let succeeded = GetExitCodeProcess(process, &mut exit_code) != 0;
        CloseHandle(process);
        succeeded && exit_code == STILL_ACTIVE
    }
}

#[cfg(not(windows))]
fn is_process_alive(_pid: u32) -> bool {
    true
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let prefix = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() { format!("{prefix}…") } else { prefix }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn state_name(state: &State) -> &'static str {
    match state {
        State::Idle => "idle",
        State::Open => "open",
        State::Working => "working",
    }
}

fn empty_snapshot(state: State) -> Snapshot {
    Snapshot {
        state,
        prompt: String::new(),
        reply: String::new(),
        transcript: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_turn_starts_open() {
        let lines = vec![
            r#"{"message":{"role":"user","content":[{"type":"text","text":"问题"}]}}"#.to_string(),
            r#"{"message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"回复"}]}}"#.to_string(),
        ];
        let snapshot = analyze_lines(&lines);
        assert_eq!(snapshot.state, State::Open);
        assert_eq!(snapshot.reply, "回复");
    }

    #[test]
    fn unanswered_user_turn_is_working_and_normalized() {
        let lines = vec![
            r#"{"message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"旧回复"}]}}"#.to_string(),
            r#"{"message":{"role":"user","content":[{"type":"text","text":"请帮我\n  检查问题"}]}}"#.to_string(),
        ];
        let snapshot = analyze_lines(&lines);
        assert_eq!(snapshot.state, State::Working);
        assert_eq!(snapshot.prompt, "请帮我 检查问题");
    }

    #[test]
    fn rejected_tool_request_ends_working_state() {
        let lines = vec![
            r#"{"type":"assistant","message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"上一轮回复"}]}}"#.to_string(),
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"需要执行工具的问题"}]}}"#.to_string(),
            r#"{"type":"user","toolDenialKind":"user-rejected","message":{"role":"user","content":[{"type":"tool_result","is_error":true,"content":"The user rejected this tool use."}]}}"#.to_string(),
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user for tool use]"}]}}"#.to_string(),
        ];

        let snapshot = analyze_lines(&lines);

        assert_eq!(snapshot.state, State::Open);
        assert_eq!(snapshot.prompt, "需要执行工具的问题");
        assert!(snapshot.reply.is_empty());
    }

    #[test]
    fn historical_reply_from_another_transcript_is_not_published() {
        let previous = Snapshot {
            state: State::Working,
            prompt: "当前问题".to_string(),
            reply: String::new(),
            transcript: Some(PathBuf::from("current.jsonl")),
        };
        let other_session = Snapshot {
            state: State::Open,
            prompt: "其他会话问题".to_string(),
            reply: "其他会话历史回复".to_string(),
            transcript: Some(PathBuf::from("history.jsonl")),
        };
        let same_session = Snapshot {
            state: State::Open,
            prompt: "当前问题".to_string(),
            reply: "当前回复".to_string(),
            transcript: Some(PathBuf::from("current.jsonl")),
        };

        assert!(!should_publish_reply(Some(&previous), &other_session));
        assert!(should_publish_reply(Some(&previous), &same_session));
    }

    #[test]
    fn finds_transcript_by_session_id_and_ignores_a_newer_empty_session() {
        let unique = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("cc-pet-status-selection-{unique}"));
        let sessions = root.join("sessions");
        let projects = root.join("projects");
        let project = projects.join("e--code-vscode-plugin-cc-pet");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(
            sessions.join("100.json"),
            r#"{"sessionId":"active-session","cwd":"E:\\code\\vscode_plugin\\cc-pet"}"#,
        )
        .unwrap();
        fs::write(
            sessions.join("200.json"),
            r#"{"sessionId":"debug-session","cwd":"E:\\code\\vscode_plugin\\cc-pet"}"#,
        )
        .unwrap();
        let transcript = project.join("active-session.jsonl");
        fs::write(&transcript, "{}\n").unwrap();

        let selection = select_active_transcript(&sessions, &projects);

        assert!(selection.has_sessions);
        assert_eq!(selection.transcript.as_deref(), Some(transcript.as_path()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn selects_the_most_recently_updated_transcript_across_windows() {
        let unique = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("cc-pet-status-activity-{unique}"));
        let sessions = root.join("sessions");
        let projects = root.join("projects");
        let project_a = projects.join("window-a");
        let project_b = projects.join("window-b");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&project_a).unwrap();
        fs::create_dir_all(&project_b).unwrap();
        fs::write(sessions.join("a.json"), r#"{"sessionId":"session-a"}"#).unwrap();
        fs::write(sessions.join("b.json"), r#"{"sessionId":"session-b"}"#).unwrap();
        fs::write(project_b.join("session-b.jsonl"), "{}\n").unwrap();
        thread::sleep(Duration::from_millis(20));
        let active_transcript = project_a.join("session-a.jsonl");
        fs::write(&active_transcript, "{}\n").unwrap();

        let selection = select_active_transcript(&sessions, &projects);

        assert_eq!(selection.transcript.as_deref(), Some(active_transcript.as_path()));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn ignores_session_metadata_for_an_exited_process() {
        let unique = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("cc-pet-status-dead-process-{unique}"));
        let sessions = root.join("sessions");
        let projects = root.join("projects");
        let project = projects.join("project");
        fs::create_dir_all(&sessions).unwrap();
        fs::create_dir_all(&project).unwrap();
        fs::write(
            sessions.join("active.json"),
            format!(r#"{{"pid":{},"sessionId":"active"}}"#, std::process::id()),
        )
        .unwrap();
        fs::write(
            sessions.join("stale.json"),
            r#"{"pid":4294967295,"sessionId":"stale"}"#,
        )
        .unwrap();
        let active_transcript = project.join("active.jsonl");
        fs::write(&active_transcript, "{}\n").unwrap();
        fs::write(project.join("stale.jsonl"), "{}\n").unwrap();

        let selection = select_active_transcript(&sessions, &projects);

        assert_eq!(selection.transcript.as_deref(), Some(active_transcript.as_path()));
        fs::remove_dir_all(root).unwrap();
    }
}
