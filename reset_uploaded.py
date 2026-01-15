"""Reset contacts that were incorrectly marked as uploaded."""
import database as db

conn = db.get_connection()
cursor = conn.cursor()

# Reset all contacts marked as 'uploaded' back to 'pending'
cursor.execute("""
    UPDATE linkedin_contacts 
    SET salesforce_status = 'pending', 
        salesforce_uploaded_at = NULL, 
        salesforce_upload_batch = NULL 
    WHERE salesforce_status = 'uploaded'
""")

count = cursor.rowcount
conn.commit()
conn.close()

print(f"Reset {count} contacts from 'uploaded' back to 'pending'")


