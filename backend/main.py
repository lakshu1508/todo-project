import os
import bcrypt
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from apscheduler.schedulers.background import BackgroundScheduler

# --- 1. CLOUD DATABASE CONFIGURATION ---
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./todo_app.db")

# Automatically convert legacy postgres:// prefixes to postgresql:// for SQLAlchemy
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- 2. SECURITY & MODERN RAW BCRYPT HASHING (NO PASSLIB) ---
def hash_password(password: str) -> str:
    safe_password = password[:72] if len(password) > 72 else password
    password_bytes = safe_password.encode('utf-8')
    
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        safe_password = plain_password[:72] if len(plain_password) > 72 else plain_password
        password_bytes = safe_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        return False

# --- 3. DATABASE MODELS ---
class DBUser(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    
    # Cascade relationship to clear items cleanly if a user profile leaves database
    todos = relationship("DBTodo", back_populates="owner", cascade="all, delete-orphan", foreign_keys="DBTodo.user_email")

class DBTodo(Base):
    __tablename__ = "todos"
    id = Column(Integer, primary_key=True, index=True)
    text = Column(String, nullable=False)
    completed = Column(Boolean, default=False)
    timestamp = Column(String, nullable=False) 
    reminder = Column(String, nullable=True)   
    reminder_triggered = Column(Boolean, default=False)
    
    # Track who issued the task vs who is designated to execute it
    assigned_by = Column(String, nullable=False)
    assigned_to = Column(String, nullable=False)
    
    user_email = Column(String, ForeignKey("users.email"), nullable=False)
    owner = relationship("DBUser", back_populates="todos", foreign_keys=[user_email])

# Spin up structural configurations safely
Base.metadata.create_all(bind=engine)

# --- 4. PYDANTIC SCHEMAS ---
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = None
    username: Optional[str] = None 

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    email: str
    name: str
    class Config:
        from_attributes = True

class TodoCreate(BaseModel):
    text: str
    timestamp: str
    assigned_to: str
    reminder: Optional[str] = None

class TodoResponse(BaseModel):
    id: int
    text: str
    completed: bool
    timestamp: str
    reminder: Optional[str] = None
    reminder_triggered: bool
    user_email: str
    assigned_by: str
    assigned_to: str
    status: str = "In Progress"
    
    class Config:
        from_attributes = True

# --- 5. DATA INJECTION DEPENDENCY ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- 6. CRON JOB REMINDER ENGINE ---
def check_reminders_cron():
    db = SessionLocal()
    try:
        now_str = datetime.now().strftime("%Y-%m-%dT%H:%M")
        due_todos = db.query(DBTodo).filter(
            DBTodo.completed == False,
            DBTodo.reminder_triggered == False,
            DBTodo.reminder.like(f"{now_str}%")
        ).all()
        
        for todo in due_todos:
            print(f"⏰ CRON MATCH DETECTED: Client {todo.user_email} requirement '{todo.text}' is due!")
            todo.reminder_triggered = True
            
        db.commit()
    except Exception as e:
        print(f"Cron execution issue: {e}")
    finally:
        db.close()

scheduler = BackgroundScheduler()
scheduler.add_job(check_reminders_cron, 'cron', minute='*')
scheduler.start()

# --- 7. FASTAPI APPLICATION SETUP ---
app = FastAPI(title="Client Tracker Full-Stack Backend Pipeline")

# Whitelist development environment alongside dynamic production fallback environment variable
LIVE_FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    LIVE_FRONTEND_URL
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 7.5 HEALTH-CHECK WAKE ROUTE FOR CRON JOBS ---
@app.get("/")
def keep_awake_endpoint():
    return {
        "status": "online",
        "message": "Pipeline active. Prevented spin-down state.",
        "timestamp": datetime.now().isoformat()
    }

# --- 8. AUTHENTICATION API ROUTES ---

@app.post("/api/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register_user(user_data: UserRegister, db: Session = Depends(get_db)):
    existing_user = db.query(DBUser).filter(DBUser.email == user_data.email.lower()).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="A profile with this email already exists.")
    
    resolved_name = user_data.name or user_data.username or "User"

    new_user = DBUser(
        email=user_data.email.lower(),
        name=resolved_name,
        password_hash=hash_password(user_data.password)
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.post("/api/login", response_model=UserResponse)
def login_user(credentials: UserLogin, db: Session = Depends(get_db)):
    user = db.query(DBUser).filter(DBUser.email == credentials.email.lower()).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password combination.")
    return user

@app.get("/api/profiles", response_model=List[UserResponse])
def get_all_profiles(db: Session = Depends(get_db)):
    return db.query(DBUser).all()

# --- 9. TODO ACTIONS API ROUTES ---

@app.post("/api/todos/{email}", response_model=TodoResponse)
def create_todo(email: str, todo_data: TodoCreate, db: Session = Depends(get_db)):
    # Create the task entry with target routing setup
    new_todo = DBTodo(
        text=todo_data.text,
        timestamp=todo_data.timestamp,
        reminder=todo_data.reminder,
        assigned_by=email.lower(),
        assigned_to=todo_data.assigned_to.lower(),
        user_email=email.lower()
    )
    db.add(new_todo)
    db.commit()
    db.refresh(new_todo)
    
    # Attach a helper status text string for schema mapping requirements
    new_todo.status = "Done" if new_todo.completed else "In Progress"
    return new_todo

@app.get("/api/todos/my-work/{email}", response_model=List[TodoResponse])
def get_my_work_todos(email: str, db: Session = Depends(get_db)):
    # Returns tasks assigned TO this specific user by anyone
    todos = db.query(DBTodo).filter(DBTodo.assigned_to == email.lower()).all()
    for todo in todos:
        todo.status = "Done" if todo.completed else "In Progress"
    return todos

@app.get("/api/todos/tracked/{email}", response_model=List[TodoResponse])
def get_tracked_outbound_todos(email: str, db: Session = Depends(get_db)):
    # Returns tasks assigned BY this user to other profiles
    todos = db.query(DBTodo).filter(
        DBTodo.assigned_by == email.lower(),
        DBTodo.assigned_to != email.lower()
    ).all()
    for todo in todos:
        todo.status = "Done" if todo.completed else "In Progress"
    return todos

@app.patch("/api/todos/{todo_id}/toggle", response_model=TodoResponse)
def toggle_todo_status(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(DBTodo).filter(DBTodo.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=404, detail="Task not found.")
    todo.completed = not todo.completed
    db.commit()
    db.refresh(todo)
    todo.status = "Done" if todo.completed else "In Progress"
    return todo

@app.patch("/api/todos/{todo_id}/triggered", response_model=TodoResponse)
def mark_reminder_triggered(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(DBTodo).filter(DBTodo.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=404, detail="Task not found.")
    todo.reminder_triggered = True
    db.commit()
    db.refresh(todo)
    todo.status = "Done" if todo.completed else "In Progress"
    return todo

@app.delete("/api/todos/{todo_id}")
def delete_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(DBTodo).filter(DBTodo.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=404, detail="Task not found.")
    db.delete(todo)
    db.commit()
    return {"message": "Task successfully deleted"}
