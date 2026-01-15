"""Reset contacts that were incorrectly marked as uploaded, except Vertex Pharmaceuticals."""
import database as db

conn = db.get_connection()
cursor = conn.cursor()

# Reset all contacts marked as 'uploaded' EXCEPT Vertex Pharmaceuticals
cursor.execute("""
    UPDATE linkedin_contacts 
    SET salesforce_status = 'pending', 
        salesforce_uploaded_at = NULL, 
        salesforce_upload_batch = NULL 
    WHERE salesforce_status IN ('uploaded', 'partial', 'failed')
    AND company_name NOT LIKE '%Vertex%'
""")

count = cursor.rowcount
conn.commit()

# Check how many Vertex contacts remain as uploaded
cursor.execute("""
    SELECT COUNT(*) FROM linkedin_contacts 
    WHERE salesforce_status = 'uploaded' 
    AND company_name LIKE '%Vertex%'
""")
vertex_count = cursor.fetchone()[0]

conn.close()

print(f"Reset {count} contacts back to 'pending'")
print(f"Kept {vertex_count} Vertex Pharmaceuticals contacts as 'uploaded'")


