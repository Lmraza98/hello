"""
Backend workflow services — reliable multi-step operations.

These services encapsulate data-heavy multi-step operations that were
previously assembled on the frontend.  The frontend becomes a thin client
that calls these endpoints and handles user interaction gates (confirmations,
selections) between calls.
"""
