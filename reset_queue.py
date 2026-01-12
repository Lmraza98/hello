"""Quick script to reset the send queue."""
import database as db

conn = db.get_connection()
c = conn.cursor()
c.execute("DELETE FROM send_queue WHERE status='pending'")
conn.commit()
print(f"Cleared {c.rowcount} pending items from send queue")
conn.close()



