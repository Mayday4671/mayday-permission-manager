package com.mayday.common;

/** A required external dependency is unavailable or has not been configured. */
public class ServiceUnavailableException extends RuntimeException {
  /** Accepts a fixed, user-safe explanation without model-provider diagnostics or credentials. */
  public ServiceUnavailableException(String message) {
    super(message);
  }
}
