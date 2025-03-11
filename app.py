from flask import Flask, request, jsonify, redirect, session, url_for, send_file
from flask_cors import CORS
from pypdf import PdfReader
import openai
import json
import os
from gcsa.google_calendar import GoogleCalendar
from gcsa.event import Event
from datetime import datetime
from time import sleep
from authlib.integrations.flask_client import OAuth
from io import BytesIO
from ics import Calendar, Event as ICSEvent
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv('FLASK_SECRET_KEY', os.urandom(24))  # For session management

# Configure CORS
CORS(app, resources={
    r"/*": {
        "origins": ["http://localhost:3000"],  # Update with your frontend URL
        "methods": ["GET", "POST"],
        "allow_headers": ["Content-Type"],
        "supports_credentials": True
    }
})

# OAuth configuration
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=os.getenv('GOOGLE_CLIENT_ID'),
    client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={
        'scope': 'openid email profile https://www.googleapis.com/auth/calendar'
    }
)

# OpenAI configuration
openai.api_key = os.getenv('OPENAI_API_KEY')

# Prompt for OpenAI
PROMPT = """
Extract all homework, projects, exams, final exams, and their titles from the following syllabus. Return the data in strict JSON format without organizing by category.

[
  {
    "summary": "Assignment title",
    "start": {
      "date": "YYYY-MM-DD",
      "time": "HH:MM:SS"
    }
  }
]
"""

def extract_text_from_pdf(pdf):
    reader = PdfReader(pdf)
    content = ''.join(page.extract_text() for page in reader.pages if page.extract_text())
    return content

def get_events_from_content(content):
    response = openai.ChatCompletion.create(
        model="gpt-4",
        messages=[
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": content}
        ],
        temperature=0
    )
    try:
        json_str = response.choices[0].message.content
        # Extract JSON from the response
        if "```json" in json_str:
            json_str = json_str.split("```json")[1].split("```")[0].strip()
        elif "```" in json_str:
            json_str = json_str.split("```")[1].split("```")[0].strip()
        events = json.loads(json_str)
        return events
    except (IndexError, json.JSONDecodeError) as e:
        raise ValueError("Failed to parse events from AI response.")

def get_google_calendar_creds(token):
    from google.oauth2.credentials import Credentials
    creds = Credentials(
        token=token['access_token'],
        refresh_token=token.get('refresh_token'),
        token_uri='https://oauth2.googleapis.com/token',
        client_id=os.getenv('GOOGLE_CLIENT_ID'),
        client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
        scopes=['https://www.googleapis.com/auth/calendar']
    )
    return creds

def add_events_to_google_calendar(events, creds):
    calendar = GoogleCalendar(credentials=creds)
    events_added = 0
    for event_data in events:
        try:
            start_datetime = datetime.strptime(
                f"{event_data['start']['date']} {event_data['start']['time']}",
                "%Y-%m-%d %H:%M:%S"
            )
            event = Event(
                event_data["summary"],
                start=start_datetime,
                minutes_before_email_reminder=30
            )
            calendar.add_event(event)
            events_added += 1
            sleep(1)  # To respect rate limits
        except Exception as e:
            print(f"Failed to add event '{event_data['summary']}': {e}")
    return events_added

def create_ics_file(events):
    cal = Calendar()
    for event_data in events:
        try:
            event = ICSEvent()
            event.name = event_data["summary"]
            event.begin = f"{event_data['start']['date']} {event_data['start']['time']}"
            cal.events.add(event)
        except Exception as e:
            print(f"Failed to add ICS event '{event_data['summary']}': {e}")
    ics_bytes = cal.serialize().encode('utf-8')
    return BytesIO(ics_bytes)

@app.route('/auth/google')
def google_auth():
    return google.authorize_redirect(
        redirect_uri=url_for('callback', _external=True)
    )

@app.route('/auth/callback')
def callback():
    try:
        token = google.authorize_access_token()
        session['google_token'] = token
        return redirect('http://localhost:3000')  # Update with your frontend URL
    except Exception as e:
        print(f"Auth error: {e}")
        return redirect('http://localhost:3000?error=auth_failed')  # Update with your frontend URL

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'google_token' not in session:
        return jsonify({"error": "Not authenticated"}), 401

    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    if file.filename == '' or not file.filename.lower().endswith('.pdf'):
        return jsonify({"error": "Please upload a valid PDF file"}), 400

    calendar_choice = request.form.get('calendar')
    if calendar_choice not in ['google', 'apple']:
        return jsonify({"error": "Invalid calendar choice"}), 400
    processing_results = []
    try:
        # Stage 1: Extract PDF text
        processing_results.append({
            "filename": file.filename,
            "status": "Extracting text from PDF...",
            "stage": "pdf_extraction"
        })
        content = extract_text_from_pdf(file)
        
        # Stage 2: Get events from OpenAI
        processing_results.append({
            "filename": file.filename,
            "status": "Processing with OpenAI...",
            "stage": "ai_processing"
        })
        events = get_events_from_content(content)
        
        # Stage 3: Add to Calendar
        processing_results.append({
            "filename": file.filename,
            "status": "Adding events to calendar...",
            "stage": "calendar_update"
        })

        if calendar_choice == 'google':
            # Retrieve user-specific credentials
            creds = get_google_calendar_creds(session['google_token'])
            events_added = add_events_to_google_calendar(events, creds)
            
            # Final success stage
            processing_results.append({
                "filename": file.filename,
                "status": f"Successfully added {events_added} events to Google Calendar",
                "stage": "complete"
            })
            
            return jsonify({
                "message": f"Successfully added {events_added} events to Google Calendar",
                "processing_results": processing_results
            })
        else:
            ics_file = create_ics_file(events)
            
            # Final success stage
            processing_results.append({
                "filename": file.filename,
                "status": "Calendar file generated successfully",
                "stage": "complete"
            })
            
            return send_file(
                ics_file,
                as_attachment=True,
                download_name='events.ics',
                mimetype='text/calendar'
            )
            
    except Exception as e:
        # Error stage
        processing_results.append({
            "filename": file.filename,
            "status": f"Error: {str(e)}",
            "stage": "error"
        })
        raise e

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "API is running"}), 200

@app.route('/auth/status', methods=['GET'])
def auth_status():
    return jsonify({
        'authenticated': 'google_token' in session
    })

if __name__ == '__main__':
    app.run(debug=True, port=5002)

