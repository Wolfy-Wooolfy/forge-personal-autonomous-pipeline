const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('app'));

// In-memory data stores (prototype only)
const contacts = [];
const leads = [];
const tickets = [];

// Simple role-based access control middleware (prototype)
const roles = ['sales_representative', 'customer_support_agent', 'manager'];
function checkRole(role) {
  return (req, res, next) => {
    const userRole = req.headers['x-user-role'];
    if (!userRole || !roles.includes(userRole)) {
      return res.status(401).json({ error: 'Unauthorized: Role missing or invalid' });
    }
    if (role && userRole !== role && userRole !== 'manager') {
      return res.status(403).json({ error: 'Forbidden: Insufficient role' });
    }
    next();
  };
}

// Contact Management
app.get('/api/contacts', checkRole(), (req, res) => {
  res.json(contacts);
});

app.post('/api/contacts', checkRole('sales_representative'), (req, res) => {
  const contact = req.body;
  contact.id = contacts.length + 1;
  contacts.push(contact);
  res.status(201).json(contact);
});

// Lead and Opportunity Management
app.get('/api/leads', checkRole(), (req, res) => {
  res.json(leads);
});

app.post('/api/leads', checkRole('sales_representative'), (req, res) => {
  const lead = req.body;
  lead.id = leads.length + 1;
  leads.push(lead);
  res.status(201).json(lead);
});

// Sales Pipeline Tracking (simple status update)
app.put('/api/leads/:id/status', checkRole('sales_representative'), (req, res) => {
  const id = parseInt(req.params.id);
  const lead = leads.find(l => l.id === id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  lead.status = req.body.status;
  res.json(lead);
});

// Customer Support Ticketing
app.get('/api/tickets', checkRole(), (req, res) => {
  res.json(tickets);
});

app.post('/api/tickets', checkRole('customer_support_agent'), (req, res) => {
  const ticket = req.body;
  ticket.id = tickets.length + 1;
  ticket.status = 'open';
  tickets.push(ticket);
  res.status(201).json(ticket);
});

app.put('/api/tickets/:id/status', checkRole('customer_support_agent'), (req, res) => {
  const id = parseInt(req.params.id);
  const ticket = tickets.find(t => t.id === id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  ticket.status = req.body.status;
  res.json(ticket);
});

// Basic Reporting Endpoint (counts)
app.get('/api/reports/summary', checkRole('manager'), (req, res) => {
  res.json({
    totalContacts: contacts.length,
    totalLeads: leads.length,
    openTickets: tickets.filter(t => t.status === 'open').length
  });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/app/index.html');
});

app.listen(PORT, () => {
  console.log(`CRM prototype running on port ${PORT}`);
});
