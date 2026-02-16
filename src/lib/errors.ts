export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class GmailError extends AppError {
  constructor(message: string) {
    super(message, "GMAIL_ERROR");
    this.name = "GmailError";
  }
}

export class ClaudeError extends AppError {
  constructor(message: string) {
    super(message, "CLAUDE_ERROR");
    this.name = "ClaudeError";
  }
}

export class SchedulingError extends AppError {
  constructor(message: string) {
    super(message, "SCHEDULING_ERROR");
    this.name = "SchedulingError";
  }
}

export class AuthError extends AppError {
  constructor(message: string) {
    super(message, "AUTH_ERROR", 401);
    this.name = "AuthError";
  }
}
