import React, { useState, useEffect } from 'react';

// Targets cloud service APIs when deployed, falls back to local machine loop automatically
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

export default function TodoList() {
  const [userEmail, setUserEmail] = useState(null);
  const [userName, setUserName] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [isNewUser, setIsNewUser] = useState(false);
  const [authError, setAuthError] = useState('');

  const [todos, setTodos] = useState([]);
  const [taskText, setTaskText] = useState('');
  const [reminderTime, setReminderTime] = useState('');

  // 🛠️ CRITICAL ANTI-DUPLICATION LOCK STATE
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchSavedProfiles();
    
    const activeEmail = localStorage.getItem('active_sandbox_user');
    const activeName = localStorage.getItem('active_sandbox_username');
    if (activeEmail && activeName) {
      setUserEmail(activeEmail);
      setUserName(activeName);
      fetchUserTodos(activeEmail);
    }
  }, []);

  useEffect(() => {
    const checkReminders = setInterval(() => {
      const nowString = new Date().toLocaleString([], { 
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' 
      });

      todos.forEach(todo => {
        if (todo.reminder && !todo.completed && !todo.reminder_triggered) {
          const todoReminderString = new Date(todo.reminder).toLocaleString([], {
            year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
          });

          if (nowString === todoReminderString) {
            handleMarkTriggeredInBackend(todo.id);
            playNotificationSound();
            alert(`⏰ REMINDER FOR ${userName || userEmail}:\n\nTask: "${todo.text}"`);
          }
        }
      });
    }, 5000);

    return () => clearInterval(checkReminders);
  }, [todos, userEmail, userName]);

  const fetchSavedProfiles = async () => {
    try {
      const res = await fetch(`${API_BASE}/profiles`);
      if (res.ok) {
        const data = await res.json();
        setSavedAccounts(data);
      }
    } catch (err) {
      console.error("Backend link broken or sleeping", err);
    }
  };

  const fetchUserTodos = async (email) => {
    try {
      const res = await fetch(`${API_BASE}/todos/${email}`);
      if (res.ok) {
        const data = await res.json();
        setTodos(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const checkEmailStatus = (email) => {
    const formattedEmail = email.trim().toLowerCase();
    setIsNewUser(!savedAccounts.some(p => p.email === formattedEmail));
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    
    // Guard Clause: block extra clicks if network request is already processing
    if (isSubmitting) return;

    const formattedEmail = emailInput.trim().toLowerCase();
    setAuthError('');
    setIsSubmitting(true); // Lock authentication loop

    const endpoint = isNewUser ? "/register" : "/login";
    const bodyPayload = isNewUser 
      ? { email: formattedEmail, password: passwordInput, name: nameInput.trim() }
      : { email: formattedEmail, password: passwordInput };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();

      if (!res.ok) {
        setAuthError(data.detail || "Authentication failed.");
        return;
      }

      setUserEmail(data.email);
      setUserName(data.name);
      localStorage.setItem('active_sandbox_user', data.email);
      localStorage.setItem('active_sandbox_username', data.name);
      
      await fetchUserTodos(data.email);
      await fetchSavedProfiles();
    } catch (err) {
      setAuthError("Server is unreachable. Make sure uvicorn is running.");
    } finally {
      setIsSubmitting(false); // Release loop toggle safely
    }
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    
    // Guard Clause: block extra clicks if task is saving or input empty
    if (isSubmitting || !taskText.trim()) return;

    setIsSubmitting(true); // Lock input form actions

    const payload = {
      text: taskText,
      timestamp: new Date().toLocaleString(),
      reminder: reminderTime ? reminderTime : null
    };

    try {
      const res = await fetch(`${API_BASE}/todos/${userEmail}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const newTodo = await res.json();
        setTodos([...todos, newTodo]);
        setTaskText('');
        setReminderTime('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false); // Re-enable task additions
    }
  };

  const toggleTodo = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/todos/${id}/toggle`, { method: 'PATCH' });
      if (res.ok) {
        const updatedTodo = await res.json();
        setTodos(todos.map(t => t.id === id ? updatedTodo : t));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkTriggeredInBackend = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/todos/${id}/triggered`, { method: 'PATCH' });
      if (res.ok) {
        const updatedTodo = await res.json();
        setTodos(todos.map(t => t.id === id ? updatedTodo : t));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const deleteTodo = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/todos/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setTodos(todos.filter(t => t.id !== id));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectQuickAccount = (account) => {
    if (isSubmitting) return;
    setEmailInput(account.email);
    setIsNewUser(false);
    setAuthError('');
  };

  const handleLogout = () => {
    setUserEmail(null);
    setUserName('');
    setTodos([]);
    setEmailInput('');
    setPasswordInput('');
    setNameInput('');
    setIsNewUser(false);
    localStorage.removeItem('active_sandbox_user');
    localStorage.removeItem('active_sandbox_username');
  };

  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
      console.log("Audio block bypass", e);
    }
  };

  const activeTasks = todos.filter(t => !t.completed);
  const doneTasks = todos.filter(t => t.completed);

  if (!userEmail) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>🔐 Client Dashboard Access (Full-Stack)</h2>

        {savedAccounts.length > 0 && (
          <div style={styles.quickSelectContainer}>
            <span style={styles.sectionLabel}>🔄 Accounts in Cloud DB:</span>
            <div style={styles.badgeRow}>
              {savedAccounts.map((account) => (
                <button 
                  key={account.email} 
                  onClick={() => handleSelectQuickAccount(account)}
                  disabled={isSubmitting}
                  style={{
                    ...styles.profileBadge,
                    opacity: isSubmitting ? 0.6 : 1,
                    borderColor: emailInput.toLowerCase() === account.email ? '#6366f1' : '#1f2937'
                  }}
                >
                  <p style={styles.badgeName}>👤 {account.name}</p>
                  <span style={styles.badgeEmail}>{account.email}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleLoginSubmit} style={styles.verticalForm}>
          <input 
            type="email" 
            placeholder="Client Email" 
            value={emailInput} 
            onChange={(e) => {
              setEmailInput(e.target.value);
              checkEmailStatus(e.target.value);
            }}
            disabled={isSubmitting}
            style={styles.input}
            required
          />

          {isNewUser && emailInput.includes('@') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={styles.infoNote}>✨ New account layout detected! Enter your profile registration name:</p>
              <input 
                type="text" 
                placeholder="Your Full Name / Company Name" 
                value={nameInput} 
                onChange={(e) => setNameInput(e.target.value)}
                disabled={isSubmitting}
                style={styles.input}
                required
              />
            </div>
          )}

          <input 
            type="password" 
            placeholder="Password" 
            value={passwordInput} 
            onChange={(e) => setPasswordInput(e.target.value)}
            disabled={isSubmitting}
            style={styles.input}
            required
          />

          {authError && <p style={styles.errorText}>⚠️ {authError}</p>}
          <button type="submit" style={{...styles.primaryBtn, opacity: isSubmitting ? 0.7 : 1}} disabled={isSubmitting}>
            {isSubmitting ? 'Processing Pipeline...' : isNewUser ? 'Register Account to DB' : 'Login Securely'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <div>
          <h3 style={{ margin: 0, color: '#6366f1' }}>💼 Connected: {userName}</h3>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>{userEmail}</span>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn} disabled={isSubmitting}>Logout</button>
      </div>

      <hr style={{ borderColor: '#1f2937', margin: '20px 0' }} />

      <h2 style={styles.title}>📝 Cloud Task Board</h2>
      
      <form onSubmit={handleAddTask} style={styles.verticalForm}>
        <input 
          type="text" 
          placeholder="What requirement needs adding to the db?" 
          value={taskText} 
          onChange={(e) => setTaskText(e.target.value)} 
          disabled={isSubmitting}
          style={styles.input}
          required
        />
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <label style={{ fontSize: '12px', color: '#9ca3af', minWidth: '95px' }}>⏰ Set Reminder:</label>
          <input 
            type="datetime-local" 
            value={reminderTime} 
            onChange={(e) => setReminderTime(e.target.value)} 
            disabled={isSubmitting}
            style={styles.input} 
          />
        </div>
        <button type="submit" style={{...styles.addBtn, opacity: isSubmitting ? 0.7 : 1}} disabled={isSubmitting}>
          {isSubmitting ? "Committing Entry..." : "Commit Task to Database"}
        </button>
      </form>

      <h4 style={{ ...styles.sectionLabel, marginTop: '25px', color: '#f59e0b' }}>⚡ In Progress ({activeTasks.length})</h4>
      <ul style={styles.list}>
        {activeTasks.map(todo => (
          <li key={todo.id} style={styles.listItem}>
            <div style={styles.todoContent}>
              <div style={styles.todoTextGroup}>
                <input 
                  type="checkbox" 
                  checked={todo.completed} 
                  onChange={() => toggleTodo(todo.id)} 
                  style={styles.checkbox}
                />
                <span style={styles.todoText}>{todo.text}</span>
              </div>
              <div style={styles.metaContainer}>
                <span style={styles.metaText}>📅 Added: {todo.timestamp}</span>
                {todo.reminder && (
                  <span style={{ 
                    ...styles.metaText, 
                    color: todo.reminder_triggered ? '#6b7280' : '#f59e0b', 
                    fontWeight: '500' 
                  }}>
                    {todo.reminder_triggered ? '✅ Alert Sent:' : '🔔 Active Alert:'} {new Date(todo.reminder).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => deleteTodo(todo.id)} style={styles.deleteBtn}>🗑️</button>
          </li>
        ))}
      </ul>
      {activeTasks.length === 0 && <p style={styles.emptyText}>No active items inside cloud pipeline.</p>}

      <h4 style={{ ...styles.sectionLabel, marginTop: '30px', color: '#10b981' }}>🎉 Done ({doneTasks.length})</h4>
      <ul style={styles.list}>
        {doneTasks.map(todo => (
          <li key={todo.id} style={{ ...styles.listItem, opacity: 0.65, backgroundColor: '#090d16', borderColor: '#111827' }}>
            <div style={styles.todoContent}>
              <div style={styles.todoTextGroup}>
                <input 
                  type="checkbox" 
                  checked={todo.completed} 
                  onChange={() => toggleTodo(todo.id)} 
                  style={styles.checkbox}
                />
                <span style={{ ...styles.todoText, textDecoration: 'line-through', color: '#9ca3af' }}>{todo.text}</span>
              </div>
              <div style={styles.metaContainer}>
                <span style={styles.metaText}>🏁 Completed Element Record</span>
              </div>
            </div>
            <button onClick={() => deleteTodo(todo.id)} style={styles.deleteBtn}>🗑️</button>
          </li>
        ))}
      </ul>
      {doneTasks.length === 0 && <p style={styles.emptyText}>Nothing pushed to finished column yet.</p>}
    </div>
  );
}

const styles = {
  container: { backgroundColor: '#111827', padding: '30px', borderRadius: '12px', maxWidth: '500px', margin: '40px auto', border: '1px solid #1f2937', boxShadow: '0 4px 15px rgba(0,0,0,0.5)', fontFamily: 'system-ui, sans-serif' },
  title: { margin: '0 0 15px 0', fontSize: '20px', fontWeight: '700', color: '#fff', textAlign: 'center' },
  sectionLabel: { fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.8px', margin: '15px 0 10px 0', display: 'block' },
  quickSelectContainer: { backgroundColor: '#0b0f19', padding: '12px', borderRadius: '8px', border: '1px solid #1f2937', marginBottom: '20px' },
  badgeRow: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' },
  profileBadge: { background: '#111827', border: '1px solid #1f2937', borderRadius: '6px', padding: '6px 12px', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', minWidth: '100px' },
  badgeName: { color: '#fff', fontSize: '13px', margin: 0, fontWeight: '600' },
  badgeEmail: { color: '#6b7280', fontSize: '10px' },
  infoNote: { color: '#10b981', fontSize: '12px', margin: '0 0 -4px 0' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  verticalForm: { display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { flex: 1, padding: '10px 14px', backgroundColor: '#0b0f19', border: '1px solid #374151', borderRadius: '6px', color: '#fff', fontSize: '14px', outline: 'none' },
  primaryBtn: { padding: '12px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', marginTop: '5px', transition: 'opacity 0.2s' },
  addBtn: { padding: '12px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', transition: 'opacity 0.2s' },
  logoutBtn: { padding: '6px 12px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' },
  list: { listStyleType: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' },
  listItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', backgroundColor: '#0b0f19', padding: '14px 16px', borderRadius: '8px', border: '1px solid #1f2937' },
  todoContent: { display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 },
  todoTextGroup: { display: 'flex', alignItems: 'center', gap: '12px' },
  checkbox: { cursor: 'pointer', width: '16px', height: '16px', marginTop: '2px' },
  todoText: { fontSize: '15px', color: '#fff' },
  metaContainer: { display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '28px' },
  metaText: { fontSize: '11px', color: '#9ca3af' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '0 0 0 10px', marginTop: '2px' },
  emptyText: { color: '#4b5563', fontStyle: 'italic', fontSize: '13px', marginTop: '5px', paddingLeft: '10px' },
  errorText: { color: '#ef4444', fontSize: '12px', margin: '0' }
};
