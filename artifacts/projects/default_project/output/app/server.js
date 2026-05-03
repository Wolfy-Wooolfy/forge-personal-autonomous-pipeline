const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// In-memory data store for prototype
let employees = [
  { id: 1, name: 'Alice Johnson', position: 'HR Manager', attendance: [], leaves: [], salary: 7000, performance: [], trainings: [] },
  { id: 2, name: 'Bob Smith', position: 'Developer', attendance: [], leaves: [], salary: 5000, performance: [], trainings: [] }
];

// --- Employee Information Management ---
app.get('/api/employees', (req, res) => {
  res.json(employees);
});

app.get('/api/employees/:id', (req, res) => {
  const emp = employees.find(e => e.id === parseInt(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  res.json(emp);
});

app.post('/api/employees', (req, res) => {
  const { name, position, salary } = req.body;
  if (!name || !position || !salary) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const newEmp = {
    id: employees.length ? employees[employees.length - 1].id + 1 : 1,
    name,
    position,
    attendance: [],
    leaves: [],
    salary,
    performance: [],
    trainings: []
  };
  employees.push(newEmp);
  res.status(201).json(newEmp);
});

// --- Attendance and Leave Tracking ---
app.post('/api/employees/:id/attendance', (req, res) => {
  const emp = employees.find(e => e.id === parseInt(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const { date, status } = req.body; // status: present, absent, late
  if (!date || !status) return res.status(400).json({ error: 'Missing date or status' });
  emp.attendance.push({ date, status });
  res.json({ message: 'Attendance recorded' });
});

app.post('/api/employees/:id/leaves', (req, res) => {
  const emp = employees.find(e => e.id === parseInt(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const { from, to, reason } = req.body;
  if (!from || !to || !reason) return res.status(400).json({ error: 'Missing leave details' });
  emp.leaves.push({ from, to, reason });
  res.json({ message: 'Leave recorded' });
});

// --- Payroll Management ---
app.get('/api/employees/:id/payroll', (req, res) => {
  const emp = employees.find(e => e.id === parseInt(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  // Prototype: just return salary
  res.json({ salary: emp.salary });
});

// --- Performance Evaluation ---
app.post('/api/employees/:id/performance', (req, res) => {
  const emp = employees.find(e => e.id === parseInt(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const { date, score, comments } = req.body;
  if (!date || score === undefined) return res.status(400).json({ error: 'Missing date or score' });
  emp.performance.push({ date, score, comments: comments || '' });
  res.json({ message: 'Performance recorded' });
});

// --- Training and Development ---
app.post('/api/employees/:id/trainings', (req, res) => {
  const emp = employees.find(e => e.id === parseInt(req.params.id));
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  const { trainingName, date } = req.body;
  if (!trainingName || !date) return res.status(400).json({ error: 'Missing training name or date' });
  emp.trainings.push({ trainingName, date });
  res.json({ message: 'Training recorded' });
});

// --- Compliance and Reporting ---
app.get('/api/reports/employees', (req, res) => {
  // Prototype: return basic employee list
  res.json(employees.map(e => ({ id: e.id, name: e.name, position: e.position })));
});

// Root route
app.get('/', (req, res) => {
  res.send('<h1>HR System Prototype API</h1><p>This is a prototype HR Management System backend.</p>');
});

app.listen(PORT, () => {
  console.log(`HR System prototype running on port ${PORT}`);
});
