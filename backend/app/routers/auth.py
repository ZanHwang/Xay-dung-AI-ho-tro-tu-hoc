from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas.user import (
    UserCreate, UserResponse, UserUpdate, Token, PasswordChange
)
from app.services.auth_service import AuthService
from app.utils.security import get_current_user
from app.models import User

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user.
    """
    auth_service = AuthService(db)
    user = auth_service.create_user(user_data)
    return user


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Login with email and password.
    Returns JWT access token.
    """
    auth_service = AuthService(db)
    user = auth_service.authenticate_user(
        type("LoginData", (), {"email": form_data.username, "password": form_data.password})()
    )
    token_data = auth_service.create_token(user)
    return token_data


@router.post("/refresh", response_model=Token)
def refresh_token(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Exchange a still-valid token for a fresh one (sliding session): the
    frontend calls this while the user is active, so they are only logged out
    after a full token lifetime of inactivity, not mid-session.
    """
    return AuthService(db).create_token(current_user)


@router.post("/logout")
def logout(current_user: User = Depends(get_current_user)):
    """
    Logout current user.
    Note: Client should delete the access token.
    """
    return {"message": "Successfully logged out"}


@router.get("/me", response_model=UserResponse)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    """
    Get current user's information.
    """
    return current_user


@router.put("/me", response_model=UserResponse)
def update_current_user(
    user_update: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Update current user's information.
    """
    if user_update.full_name is not None:
        current_user.full_name = user_update.full_name

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/change-password")
def change_password(
    password_change: PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Change current user's password.
    """
    auth_service = AuthService(db)
    auth_service.change_password(
        current_user,
        password_change.old_password,
        password_change.new_password
    )
    return {"message": "Password changed successfully"}


@router.post("/forgot-password")
def forgot_password(email: str, db: Session = Depends(get_db)):
    """
    Request password reset.
    Note: Email sending not implemented in MVP.
    """
    auth_service = AuthService(db)
    user = auth_service.get_user_by_email(email)

    # Always return success to prevent email enumeration
    if user:
        # TODO: Send reset email
        pass

    return {"message": "If the email exists, a reset link has been sent"}
