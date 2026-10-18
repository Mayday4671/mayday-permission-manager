package com.mayday.common;

/** A concurrent or stale operation that the caller may retry after refreshing current state. */
public class ConflictException extends RuntimeException {
  /** Accepts only a safe business message; persistence details remain behind the API boundary. */
  public ConflictException(String message) {
    super(message);
  }
}
