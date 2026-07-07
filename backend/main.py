import os
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from sqlalchemy import create_engine, Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from passlib.context import CryptContext
from apscheduler.schedulers.background import BackgroundScheduler

# --- 1. IRONCLAD CLOUD DATABASE CONFIGURATION ---
# Reads your secure production connection string when on Render, drops back to local SQLite file for safety
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./todo_app.db")

# Automatically strips out SQLite-only configurations if connecting to production PostgreSQL
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- 2. SECURITY & HASHING (Cooperative with bcrypt 4.0.1) ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

# --- 3. DATABASE MODELS (Permanent cloud records) ---
class DBUser(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    
    todos = relationship("DBTodo", back_populates="owner", cascade="all, delete-orphan")

class DBTodo(Base):
    __tablename__ = "todos"
    id = Column(Integer, primary_key=True, index=True)
    text = Column(String, nullable=False)
    completed = Column(Boolean, default=False)
    timestamp = Column(String, nullable=False) 
    reminder = Column(String, nullable=True)   # ISO Format: YYYY-MM-DDTHH:MM
    reminder_triggered = Column(Boolean, default=False)
    
    user_email = Column(String, ForeignKey("users.email"), nullable=False)
    owner = relationship("DBUser", back_populates="todos")

# Build tables directly in the cloud PostgreSQL cluster instantly
Base.metadata.create_all(bind=engine)

# --- 4. PYDANTIC SCHEMAS (Requires email-validator package) ---
class UserRegister(BaseModel):
    email: EmailStr
    name: str
    password: str

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
    reminder: Optional[str] = None

class TodoResponse(BaseModel):
    id: int
    text: str
    completed: bool
    timestamp: str
    reminder: Optional[str] = None
    reminder_triggered: bool
    user_email: str
    class Config:
        from_attributes = True

# --- 5. DATA INJECTION DEPENDENCY ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- 6. CRON JOB REMINDER ENGINE (Runs 24/7 in background) ---
def check_reminders_cron():
    db = SessionLocal()
    try:
        # Grabs current server time format to compare up to the precise minute
        now_str = datetime.now().strftime("%Y-%m-%dT%H:%M")
        
        # Pull records that hit milestones and are un-triggered
        due_todos = db.query(DBTodo).filter(
            DBTodo.completed == False,
            DBTodo.reminder_triggered == False,
            DBTodo.reminder.like(f"{now_str}%")
        ).all()
        
        for todo in due_todos:
            print(f"⏰ CRON MATCH DETECTED: Client {todo.user_email} requirement '{todo.text}' is due!")
            
            # NOTE: Connect third-party communication utilities (Twilio, SendGrid) here!
            
            # Switch state loop flag so it ceases recurring checks
            todo.reminder_triggered = True
            
        db.commit()
    except Exception as e:
        print(f"Cron execution issue: {e}")
    finally:
        db.close()

# Spin up and register our background cron cycle to trigger every single minute
scheduler = BackgroundScheduler()
scheduler.add_job(check_reminders_cron, 'cron', minute='*')
scheduler.start()

# --- 7. FASTAPI LIFECYCLE & CORS ENVIRONMENT WHITELIST ---
app = FastAPI(title="Client Tracker Sandbox Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 8. AUTHENTICATION API ROUTES ---

@app.post("/api/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register_user(user_data: UserRegister, db: Session = Depends(get_db)):
    existing_user = db.query(DBUser).filter(DBUser.email == user_data.email.lower()).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="A profile with this email already exists.")
    
    new_user = DBUser(
        email=user_data.email.lower(),
        name=user_data.name,
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

@app.get("/api/todos/{email}", response_model=List[TodoResponse])
def get_user_todos(email: str, db: Session = Depends(get_db)):
    return db.query(DBTodo).filter(DBTodo.user_email == email.lower()).all()

@app.post("/api/todos/{email}", response_model=TodoResponse)
def create_todo(email: str, todo_data: TodoCreate, db: Session = Depends(get_db)):
    new_todo = DBTodo(
        text=todo_data.text,
        timestamp=todo_data.timestamp,
        reminder=todo_data.reminder,
        user_email=email.lower()
    )
    db.add(new_todo)
    db.commit()
    db.refresh(new_todo)
    return new_todo

@app.patch("/api/todos/{todo_id}/toggle", response_model=TodoResponse)
def toggle_todo_status(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(DBTodo).filter(DBTodo.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=404, detail="Task not found.")
    todo.completed = not todo.completed
    db.commit()
    db.refresh(todo)
    return todo

@app.patch("/api/todos/{todo_id}/triggered", response_model=TodoResponse)
def mark_reminder_triggered(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(DBTodo).filter(DBTodo.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=404, detail="Task not found.")
    todo.reminder_triggered = True
    db.commit()
    db.refresh(todo)
    return todo

@app.delete("/api/todos/{todo_id}")
def delete_todo(todo_id: int, db: Session = Depends(get_db)):
    todo = db.query(DBTodo).filter(DBTodo.id == todo_id).first()
    if not todo:
        raise HTTPException(status_code=404, detail="Task not found.")
    db.delete(todo)
    db.commit()
    return {"message": "Task successfully deleted"}
