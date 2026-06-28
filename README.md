# AttendAI — AI-Based Student Attendance System
### Brainware University | Dept. of Computer Science & Engineering

---

## Quick Start

### Windows
Double-click `run.bat` — it handles everything automatically.

### Mac / Linux
```bash
chmod +x run.sh
./run.sh
```

### Manual (VS Code Terminal)
```bash
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux

pip install -r requirements.txt
python app.py
```

Open: **http://127.0.0.1:5000**

---

## How to Use

### Step 1 — Add Students
- Go to **Students** tab
- Click **+ Add Student**
- Fill in Roll No, Name, Department, Year

### Step 2 — Enroll Faces
- Go to **Enroll Face** tab
- Select a student from the list
- Click **Open Camera** → position face → **Capture & Enroll**
- Repeat for all students

### Step 3 — Take Attendance
- Go to **Live Camera** tab
- Click **Start Camera**
- Students in front of the camera are automatically recognized and marked present

### Step 4 — Export
- Go to **Dashboard**
- Click **Export CSV** to download the attendance sheet

---

## Project Structure
```
attendance_system/
├── app.py                  ← Flask backend (API + face recognition)
├── requirements.txt        ← Python dependencies
├── run.bat / run.sh        ← One-click launch scripts
├── templates/
│   └── index.html          ← Main UI
├── static/
│   ├── css/style.css       ← Styling
│   └── js/app.js           ← Frontend logic
├── student_faces/          ← Enrolled face images (auto-created)
├── attendance_data/        ← Daily CSV files (auto-created)
└── models/                 ← Face encodings + student DB (auto-created)
```

## Tech Stack
- **Backend:** Python, Flask, OpenCV
- **Face Recognition:** OpenCV Haar Cascade + LBP histogram matching
- **Data:** NumPy, Pandas, JSON, CSV
- **Frontend:** HTML5, CSS3, Vanilla JavaScript

## Requirements
- Python 3.10+
- Webcam / USB camera
- Good lighting for best accuracy
