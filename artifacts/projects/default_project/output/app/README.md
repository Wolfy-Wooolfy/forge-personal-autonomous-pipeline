# CRM Prototype Application

This is a prototype implementation of a Customer Relationship Management (CRM) system demonstrating core features such as contact management, lead and opportunity management, sales pipeline tracking, customer support ticketing, and basic reporting.

## Features
- Contact Management
- Lead and Opportunity Management
- Sales Pipeline Tracking
- Customer Support Ticketing
- Role-based access control (prototype level)

## Roles
- sales_representative
- customer_support_agent
- manager

## How to Run

1. Make sure you have [Node.js](https://nodejs.org/) installed (version 14 or higher recommended).
2. Open a terminal in the root directory (where `package.json` is located).
3. Run `npm install` to install dependencies.
4. Run `npm start` to start the server.
5. Open your browser and navigate to `http://localhost:3000`.

## How to Use

- When you open the web app, you will be prompted to enter your role. Enter one of the roles listed above.
- Use the forms to add contacts, leads, and support tickets.
- The app sends API requests with your role in the header to simulate role-based access control.

## Notes
- This is a prototype and not production-ready.
- Data is stored in memory and will be lost when the server restarts.
- Security features such as data encryption are not implemented.
- Integration with email, calendar, and marketing tools is not included.

## License
MIT
