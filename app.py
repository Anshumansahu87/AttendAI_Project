import os
import cv2
import numpy as np
import pandas as pd
import pickle
import base64
import json
from datetime import datetime, date
from flask import Flask, render_template, request, jsonify, send_file, Response
from werkzeug.utils import secure_filename
import threading
import time

app = Flask(__name__)
app.secret_key = 'attendai_brainware_2024'

STUDENT_FACES_DIR = 'student_faces'
ATTENDANCE_DIR = 'attendance_data'
MODELS_DIR = 'models'
ENCODINGS_FILE = os.path.join(MODELS_DIR, 'face_encodings.pkl')
STUDENTS_FILE = os.path.join(MODELS_DIR, 'students.json')

os.makedirs(STUDENT_FACES_DIR, exist_ok=True)
os.makedirs(ATTENDANCE_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)

# ─── State ────────────────────────────────────────────────────────────────────
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
known_encodings = []
known_names = []
students_db = {}
attendance_today = {}
camera_active = False
camera_thread = None
latest_frame = None
frame_lock = threading.Lock()

# ─── Helpers ──────────────────────────────────────────────────────────────────
def load_students():
    global students_db
    if os.path.exists(STUDENTS_FILE):
        with open(STUDENTS_FILE, 'r') as f:
            students_db = json.load(f)
    return students_db

def save_students():
    with open(STUDENTS_FILE, 'w') as f:
        json.dump(students_db, f, indent=2)

def load_encodings():
    global known_encodings, known_names
    if os.path.exists(ENCODINGS_FILE):
        with open(ENCODINGS_FILE, 'rb') as f:
            data = pickle.load(f)
            known_encodings = data.get('encodings', [])
            known_names = data.get('names', [])

def save_encodings():
    with open(ENCODINGS_FILE, 'wb') as f:
        pickle.dump({'encodings': known_encodings, 'names': known_names}, f)

def get_attendance_file():
    today = date.today().strftime('%Y-%m-%d')
    return os.path.join(ATTENDANCE_DIR, f'attendance_{today}.csv')

def load_today_attendance():
    global attendance_today
    att_file = get_attendance_file()
    if os.path.exists(att_file):
        df = pd.read_csv(att_file)
        attendance_today = dict(zip(df['roll_no'], df['status']))
    else:
        attendance_today = {sid: 'absent' for sid in students_db}

def save_attendance():
    att_file = get_attendance_file()
    rows = []
    for roll, student in students_db.items():
        status = attendance_today.get(roll, 'absent')
        time_marked = attendance_today.get(f'{roll}_time', '')
        rows.append({
            'roll_no': roll,
            'name': student['name'],
            'department': student.get('dept', ''),
            'status': status,
            'time_marked': time_marked,
            'date': date.today().strftime('%Y-%m-%d')
        })
    df = pd.DataFrame(rows)
    df.to_csv(att_file, index=False)

def get_face_encoding_simple(image):
    """Simple histogram-based face descriptor (works without dlib)."""
    face_img = cv2.resize(image, (64, 64))
    face_gray = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY) if len(face_img.shape) == 3 else face_img
    hist = cv2.calcHist([face_gray], [0], None, [64], [0, 256])
    hist = cv2.normalize(hist, hist).flatten()
    lbp = np.zeros_like(face_gray, dtype=np.uint8)
    for i in range(1, face_gray.shape[0]-1):
        for j in range(1, face_gray.shape[1]-1):
            center = face_gray[i, j]
            code = 0
            neighbors = [(i-1,j-1),(i-1,j),(i-1,j+1),(i,j+1),(i+1,j+1),(i+1,j),(i+1,j-1),(i,j-1)]
            for k,(ni,nj) in enumerate(neighbors):
                if face_gray[ni,nj] >= center:
                    code |= (1 << k)
            lbp[i,j] = code
    lbp_hist = cv2.calcHist([lbp], [0], None, [64], [0, 256])
    lbp_hist = cv2.normalize(lbp_hist, lbp_hist).flatten()
    return np.concatenate([hist, lbp_hist])

def compare_faces(known_enc, unknown_enc, threshold=0.35):
    if len(known_enc) == 0:
        return [], []
    distances = []
    for enc in known_enc:
        dist = np.linalg.norm(enc - unknown_enc)
        distances.append(dist)
    matches = [d < threshold for d in distances]
    return matches, distances

def process_frame_for_recognition(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
    recognized = []
    annotated = frame.copy()
    for (x, y, w, h) in faces:
        face_roi = frame[y:y+h, x:x+w]
        try:
            encoding = get_face_encoding_simple(face_roi)
            name = "Unknown"
            color = (0, 0, 220)
            if known_encodings:
                matches, distances = compare_faces(known_encodings, encoding)
                if any(matches):
                    best_idx = np.argmin(distances)
                    if matches[best_idx]:
                        name = known_names[best_idx]
                        color = (34, 180, 76)
                        recognized.append(name)
            cv2.rectangle(annotated, (x, y), (x+w, y+h), color, 2)
            label_bg = (x, y-30) if y > 30 else (x, y+h)
            cv2.rectangle(annotated, (label_bg[0], label_bg[1]), (label_bg[0]+w, label_bg[1]+28), color, -1)
            cv2.putText(annotated, name, (x+5, label_bg[1]+20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255,255,255), 2)
        except Exception:
            cv2.rectangle(annotated, (x, y), (x+w, y+h), (0, 140, 255), 2)
    return annotated, recognized

# ─── Camera Thread ────────────────────────────────────────────────────────────
def camera_loop():
    global latest_frame, camera_active
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    while camera_active:
        ret, frame = cap.read()
        if not ret:
            break
        annotated, recognized = process_frame_for_recognition(frame)
        for roll_name in recognized:
            for roll, student in students_db.items():
                if student['name'] == roll_name and attendance_today.get(roll) != 'present':
                    attendance_today[roll] = 'present'
                    attendance_today[f'{roll}_time'] = datetime.now().strftime('%H:%M:%S')
                    save_attendance()
        _, buffer = cv2.imencode('.jpg', annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
        with frame_lock:
            latest_frame = buffer.tobytes()
        time.sleep(0.04)
    cap.release()

def generate_frames():
    while camera_active:
        with frame_lock:
            frame = latest_frame
        if frame:
            yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        time.sleep(0.04)

# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    load_students()
    load_today_attendance()
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/api/camera/start', methods=['POST'])
def start_camera():
    global camera_active, camera_thread
    if not camera_active:
        camera_active = True
        camera_thread = threading.Thread(target=camera_loop, daemon=True)
        camera_thread.start()
    return jsonify({'status': 'started'})

@app.route('/api/camera/stop', methods=['POST'])
def stop_camera():
    global camera_active
    camera_active = False
    return jsonify({'status': 'stopped'})

@app.route('/api/students', methods=['GET'])
def get_students():
    load_students()
    load_today_attendance()
    result = []
    for roll, s in students_db.items():
        result.append({
            'roll': roll,
            'name': s['name'],
            'dept': s.get('dept', ''),
            'year': s.get('year', ''),
            'status': attendance_today.get(roll, 'absent'),
            'time': attendance_today.get(f'{roll}_time', ''),
            'has_photo': os.path.exists(os.path.join(STUDENT_FACES_DIR, f'{roll}.jpg'))
        })
    result.sort(key=lambda x: x['roll'])
    return jsonify(result)

@app.route('/api/students/add', methods=['POST'])
def add_student():
    data = request.json
    roll = data.get('roll', '').strip()
    name = data.get('name', '').strip()
    dept = data.get('dept', '').strip()
    year = data.get('year', '').strip()
    if not roll or not name:
        return jsonify({'error': 'Roll number and name are required'}), 400
    if roll in students_db:
        return jsonify({'error': 'Roll number already exists'}), 400
    students_db[roll] = {'name': name, 'dept': dept, 'year': year}
    save_students()
    attendance_today[roll] = 'absent'
    save_attendance()
    return jsonify({'success': True, 'message': f'Student {name} added successfully'})

@app.route('/api/students/delete/<roll>', methods=['DELETE'])
def delete_student(roll):
    if roll not in students_db:
        return jsonify({'error': 'Student not found'}), 404
    del students_db[roll]
    save_students()
    face_img = os.path.join(STUDENT_FACES_DIR, f'{roll}.jpg')
    if os.path.exists(face_img):
        os.remove(face_img)
    global known_encodings, known_names
    indices = [i for i, n in enumerate(known_names) if n == students_db.get(roll, {}).get('name')]
    known_encodings = [e for i,e in enumerate(known_encodings) if i not in indices]
    known_names = [n for i,n in enumerate(known_names) if i not in indices]
    save_encodings()
    return jsonify({'success': True})

@app.route('/api/enroll', methods=['POST'])
def enroll_face():
    data = request.json
    roll = data.get('roll')
    image_data = data.get('image')
    if not roll or roll not in students_db:
        return jsonify({'error': 'Invalid student'}), 400
    img_bytes = base64.b64decode(image_data.split(',')[1])
    nparr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(60,60))
    if len(faces) == 0:
        return jsonify({'error': 'No face detected. Please ensure good lighting and face the camera.'}), 400
    x, y, w, h = max(faces, key=lambda f: f[2]*f[3])
    face_roi = frame[y:y+h, x:x+w]
    cv2.imwrite(os.path.join(STUDENT_FACES_DIR, f'{roll}.jpg'), face_roi)
    encoding = get_face_encoding_simple(face_roi)
    name = students_db[roll]['name']
    existing = [i for i,n in enumerate(known_names) if n == name]
    for i in sorted(existing, reverse=True):
        known_encodings.pop(i)
        known_names.pop(i)
    known_encodings.append(encoding)
    known_names.append(name)
    save_encodings()
    return jsonify({'success': True, 'message': f'Face enrolled for {name}'})

@app.route('/api/attendance/mark', methods=['POST'])
def mark_attendance():
    data = request.json
    roll = data.get('roll')
    status = data.get('status', 'present')
    if roll not in students_db:
        return jsonify({'error': 'Student not found'}), 404
    attendance_today[roll] = status
    if status == 'present':
        attendance_today[f'{roll}_time'] = datetime.now().strftime('%H:%M:%S')
    else:
        attendance_today.pop(f'{roll}_time', None)
    save_attendance()
    return jsonify({'success': True})

@app.route('/api/attendance/stats', methods=['GET'])
def attendance_stats():
    total = len(students_db)
    present = sum(1 for r in students_db if attendance_today.get(r) == 'present')
    absent = total - present
    rate = round(present / total * 100, 1) if total > 0 else 0
    return jsonify({'total': total, 'present': present, 'absent': absent, 'rate': rate})

@app.route('/api/attendance/export', methods=['GET'])
def export_attendance():
    att_file = get_attendance_file()
    save_attendance()
    if not os.path.exists(att_file):
        return jsonify({'error': 'No attendance data'}), 404
    return send_file(att_file, as_attachment=True,
                     download_name=f'attendance_{date.today()}.csv',
                     mimetype='text/csv')

@app.route('/api/attendance/history', methods=['GET'])
def attendance_history():
    files = sorted([f for f in os.listdir(ATTENDANCE_DIR) if f.endswith('.csv')], reverse=True)
    history = []
    for f in files[:30]:
        try:
            df = pd.read_csv(os.path.join(ATTENDANCE_DIR, f))
            present = len(df[df['status'] == 'present'])
            total = len(df)
            date_str = f.replace('attendance_', '').replace('.csv', '')
            history.append({'date': date_str, 'present': present, 'total': total,
                           'rate': round(present/total*100,1) if total > 0 else 0})
        except Exception:
            pass
    return jsonify(history)

@app.route('/api/capture_frame', methods=['POST'])
def capture_frame():
    """Capture from webcam via browser (base64 image for enrollment)."""
    return jsonify({'success': True})

if __name__ == '__main__':
    load_students()
    load_encodings()
    load_today_attendance()
    print("\n" + "="*50)
    print("  AttendAI — Brainware University")
    print("  Running at: http://127.0.0.1:5000")
    print("="*50 + "\n")
    app.run(debug=True, threaded=True)
