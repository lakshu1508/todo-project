import React, { useState, useEffect } from 'react';

export default function TodoList() {
  // --- 1. PROFILE & AUTHENTICATION STATES ---
  const [userEmail, setUserEmail] = useState(null);
  const [userName, setUserName] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  
  const [savedAccounts, setSavedAccounts] = useState([]);
  const [isNewUser, setIsNewUser] = useState(false);
  const [authError, setAuthError] = useState('');

  // --- 2. TODO & REMINDER STATES ---
  const [todos, setTodos] = useState([]);
  const [taskText, setTaskText] = useState('');
  const [reminderTime, setReminderTime] = useState('');

  // --- 3. LIFECYCLE HOOKS ---
  useEffect(() => {
    const activeEmail = localStorage.getItem('active_sandbox_user');
    if (activeEmail) {
      setUserEmail(activeEmail);
      const savedTodos = localStorage.getItem(`todos_${activeEmail}`);
      if (savedTodos) setTodos(JSON.parse(savedTodos));
      
      const accounts = JSON.parse(localStorage.getItem('sandbox_profiles') || '[]');
      const currentProfile = accounts.find(a => a.email === activeEmail);
      if (currentProfile) setUserName(currentProfile.name);
    }

    const profiles = localStorage.getItem('sandbox_profiles');
    if (profiles) setSavedAccounts(JSON.parse(profiles));
  }, []);

  useEffect(() => {
    if (userEmail) {
      localStorage.setItem(`todos_${userEmail}`, JSON.stringify(todos));
    }
  }, [todos, userEmail]);

  useEffect(() => {
    const checkReminders = setInterval(() => {
      const nowString = new Date().toLocaleString([], { 
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' 
      });

      todos.forEach(todo => {
        if (todo.reminder && !todo.completed && !todo.reminderTriggered) {
          const todoReminderString = new Date(todo.reminder).toLocaleString([], {
            year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
          });

          if (nowString === todoReminderString) {
            todo.reminderTriggered = true;
            setTodos([...todos]);
            playNotificationSound();
            alert(`⏰ REMINDER FOR ${userName || userEmail}:\n\nTask: "${todo.text}"`);
          }
        }
      });
    }, 5000);

    return () => clearInterval(checkReminders);
  }, [todos, userEmail, userName]);

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
      console.log("Audio permission restriction bypassed", e);
    }
  };

  // --- 4. AUTHENTICATION HANDLERS ---
  const checkEmailStatus = (email) => {
    const formattedEmail = email.trim().toLowerCase();
    const profiles = JSON.parse(localStorage.getItem('sandbox_profiles') || '[]');
    setIsNewUser(!profiles.some(p => p.email === formattedEmail));
  };

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    const formattedEmail = emailInput.trim().toLowerCase();
    if (!formattedEmail || !passwordInput) return;

    let profiles = JSON.parse(localStorage.getItem('sandbox_profiles') || '[]');
    const existingUser = profiles.find(p => p.email === formattedEmail);

    if (isNewUser) {
      if (!nameInput.trim()) {
        setAuthError('Please enter a Profile Name.');
        return;
      }
      const newProfile = { email: formattedEmail, password: passwordInput, name: nameInput.trim() };
      profiles.push(newProfile);
      localStorage.setItem('sandbox_profiles', JSON.stringify(profiles));
      setSavedAccounts(profiles);
      setUserName(newProfile.name);
    } else {
      if (existingUser.password !== passwordInput) {
        setAuthError('Incorrect password.');
        return;
      }
      setUserName(existingUser.name);
    }

    setUserEmail(formattedEmail);
    localStorage.setItem('active_sandbox_user', formattedEmail);
    setAuthError('');
    const savedTodos = localStorage.getItem(`todos_${formattedEmail}`);
    setTodos(savedTodos ? JSON.parse(savedTodos) : []);
  };

  const handleSelectQuickAccount = (account) => {
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
  };

  // --- 5. DATA PIPELINE LOGIC ---
  const handleAddTask = (e) => {
    e.preventDefault();
    if (!taskText.trim()) return;

    const newTodo = {
      id: Date.now(),
      text: taskText,
      completed: false,
      timestamp: new Date().toLocaleString(),
      reminder: reminderTime ? reminderTime : null,
      reminderTriggered: false
    };

    setTodos([...todos, newTodo]);
    setTaskText('');
    setReminderTime('');
  };

  const toggleTodo = (id) => {
    setTodos(todos.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const deleteTodo = (id) => {
    setTodos(todos.filter(t => t.id !== id));
  };

  // Split the states dynamically into separate active and completed arrays
  const activeTasks = todos.filter(t => !t.completed);
  const doneTasks = todos.filter(t => t.completed);

  // --- 6. INTERFACE RENDERING LAYOUTS ---
  if (!userEmail) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>🔐 Client Dashboard Access</h2>

        {savedAccounts.length > 0 && (
          <div style={styles.quickSelectContainer}>
            <span style={styles.sectionLabel}>🔄 Saved Client Profiles:</span>
            <div style={styles.badgeRow}>
              {savedAccounts.map((account) => (
                <button 
                  key={account.email} 
                  onClick={() => handleSelectQuickAccount(account)}
                  style={{
                    ...styles.profileBadge,
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
            style={styles.input}
            required
          />

          {isNewUser && emailInput.includes('@') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={styles.infoNote}>✨ New account detected! Please enter a registration profile name:</p>
              <input 
                type="text" 
                placeholder="Your Full Name / Company Name" 
                value={nameInput} 
                onChange={(e) => setNameInput(e.target.value)}
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
            style={styles.input}
            required
          />

          {authError && <p style={styles.errorText}>⚠️ {authError}</p>}
          <button type="submit" style={styles.primaryBtn}>
            {isNewUser ? 'Create Profile & Login' : 'Authenticate Into Dashboard'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <div>
          <h3 style={{ margin: 0, color: '#6366f1' }}>💼 Welcome Back, {userName}!</h3>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>{userEmail}</span>
        </div>
        <button onClick={handleLogout} style={styles.logoutBtn}>Logout</button>
      </div>

      <hr style={{ borderColor: '#1f2937', margin: '20px 0' }} />

      <h2 style={styles.title}>📝 Task & Reminder Board</h2>
      
      <form onSubmit={handleAddTask} style={styles.verticalForm}>
        <input 
          type="text" 
          placeholder="What's your next client task?" 
          value={taskText} 
          onChange={(e) => setTaskText(e.target.value)} 
          style={styles.input}
          required
        />
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <label style={{ fontSize: '12px', color: '#9ca3af', minWidth: '95px' }}>⏰ Set Reminder:</label>
          <input 
            type="datetime-local" 
            value={reminderTime} 
            onChange={(e) => setReminderTime(e.target.value)} 
            style={styles.input} 
          />
        </div>
        <button type="submit" style={styles.addBtn}>Save Task</button>
      </form>

      {/* --- 🛑 SECTION 1: ACTIVE TASKS BOARDS --- */}
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
                  <span style={{ ...styles.metaText, color: '#f59e0b', fontWeight: '500' }}>
                    🔔 Alert: {new Date(todo.reminder).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => deleteTodo(todo.id)} style={styles.deleteBtn}>🗑️</button>
          </li>
        ))}
      </ul>
      {activeTasks.length === 0 && <p style={styles.emptyText}>No active items inside your timeline.</p>}

      {/* --- ✅ SECTION 2: COMPLETED "DONE" ARCHIVE --- */}
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
                <span style={styles.metaText}>🏁 Completed Project Element Archive</span>
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
  profileBadge: { background: '#111827', border: '1px solid #1f2937', borderRadius: '6px', padding: '6px 12px', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', minWidth: '100px', transition: 'all 0.2s' },
  badgeName: { color: '#fff', fontSize: '13px', margin: 0, fontWeight: '600' },
  badgeEmail: { color: '#6b7280', fontSize: '10px' },
  infoNote: { color: '#10b981', fontSize: '12px', margin: '0 0 -4px 0' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  verticalForm: { display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { flex: 1, padding: '10px 14px', backgroundColor: '#0b0f19', border: '1px solid #374151', borderRadius: '6px', color: '#fff', fontSize: '14px', outline: 'none' },
  primaryBtn: { padding: '12px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', marginTop: '5px' },
  addBtn: { padding: '12px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' },
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