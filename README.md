# 💰 ExpenseIQ — Expense Splitter with Smart Insights

**ExpenseIQ** is a full-stack web application designed to make **group expense management simple, transparent, and hassle-free**.

Whether you're travelling with friends, sharing rent, planning a trip, or managing expenses with a group, ExpenseIQ helps you record expenses, split them among members, and understand **who owes whom and how much**.

---

## 🚀 Features

### 🔐 User Authentication

* User registration and login
* Secure password hashing using **bcrypt**
* JWT-based authentication
* User-specific data and dashboards

### 👥 Group Management

* Create and manage expense groups
* Add members to groups
* View group-specific expenses
* Delete groups along with their associated expenses

### 💸 Expense Management

* Add expenses to a group
* Specify the person who paid
* Select the members involved in an expense
* Automatically calculate each member's share

### 🧮 Smart Expense Splitting

ExpenseIQ calculates individual balances based on:

* Total amount paid by each member
* Members included in each expense
* Individual shares for every expense

This allows expenses to be split **only among the people involved**, instead of automatically dividing every expense among the entire group.

### 🔄 Debt Settlement

The application calculates the final balances of group members and determines simplified transactions between members.

For example:

> A needs to receive ₹500
> B needs to receive ₹200
> C needs to pay ₹400
> D needs to pay ₹300

ExpenseIQ can simplify this into the minimum practical transactions required to settle the group.

---

## 🛠️ Tech Stack

### Frontend

* HTML5
* CSS3
* JavaScript (ES6+)

### Backend

* Node.js
* Express.js
* REST APIs

### Database

* MongoDB
* Mongoose

### Authentication & Security

* JWT (JSON Web Token)
* bcrypt

### Development Tools

* Git
* GitHub
* Postman
* MongoDB Compass
* VS Code

---

## 📂 Project Structure

```text
ExpenseIQ/
│
├── frontend/
│   ├── index.html
│   ├── login.html
│   ├── signup.html
│   ├── dashboard.html
│   ├── css/
│   └── js/
│
├── backend/
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── middleware/
│   ├── server.js
│   └── package.json
│
├── README.md
└── .gitignore
```

> The exact folder structure may vary depending on the current version of the project.

---

## ⚙️ How It Works

The basic workflow of ExpenseIQ is:

```text
User
  ↓
Sign Up / Login
  ↓
Create or Join a Group
  ↓
Add Expenses
  ↓
Select Members Involved
  ↓
Calculate Individual Shares
  ↓
Calculate Member Balances
  ↓
Simplify Debts
  ↓
Settle Expenses
```

---

## 🧠 Expense Calculation Logic

ExpenseIQ doesn't assume that every expense is shared by everyone.

For example:

**A pays ₹1000 for A and B**

```text
Total Expense = ₹1000
People involved = A, B

A's share = ₹500
B's share = ₹500
```

If A paid the entire ₹1000:

```text
A paid     = ₹1000
A's share  = ₹500
A balance  = +₹500

B paid     = ₹0
B's share  = ₹500
B balance  = -₹500
```

Therefore:

```text
B owes A ₹500
```

This approach is used to calculate the overall balances of members within a group.

---

## 🔑 API Overview

### Authentication

```text
POST /api/auth/signup
POST /api/auth/login
```

### Groups

```text
GET    /api/groups
POST   /api/groups
DELETE /api/groups/:id
```

### Expenses

```text
POST /api/expenses
GET  /api/expenses/:groupId
```

> API routes may change as the project continues to develop.

---

## 🖥️ Running the Project Locally

### 1. Clone the repository

```bash
git clone https://github.com/your-username/ExpenseIQ.git
cd ExpenseIQ
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Configure environment variables

Create a `.env` file inside the backend directory:

```env
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
```

### 4. Start the backend

```bash
npm start
```

The backend will run on:

```text
http://localhost:3000
```

### 5. Open the frontend

Open the frontend using your preferred local development server or VS Code Live Server.

---

## 🔒 Environment Variables

Do **not** commit sensitive information such as:

```text
MONGO_URI
JWT_SECRET
API keys
Passwords
Access tokens
```

Make sure `.env` is included in `.gitignore`.

---

## 🎯 Future Improvements

Planned improvements include:

* [ ] Group invitation system
* [ ] Invite users through shareable links
* [ ] Accept / reject group invitations
* [ ] Friend-based group invitations
* [ ] Expense history and activity tracking
* [ ] Better analytics and spending insights
* [ ] Improved responsive UI
* [ ] Expense categories and visual summaries
* [ ] Notifications for pending settlements
* [ ] Deployment of the complete application

---

## 👨‍💻 Team

### Sanidhya Chauhan

**Backend • Database • Application Logic**

Responsible for:

* Backend API development
* MongoDB database design
* Authentication
* Expense calculation logic
* Group and expense management
* Debt settlement logic

### Akshay Jain

**Frontend • UI/UX • Integration**

Responsible for:

* Frontend development
* User interface and experience
* Dashboard design
* Frontend-backend integration

---

## 📌 Project Type

**Minor Project — Full Stack Web Development**

**Project:** ExpenseIQ — Expense Splitter with Smart Insights

---

## ⭐ Why ExpenseIQ?

Managing group expenses manually can become confusing, especially when different expenses involve different people.

ExpenseIQ aims to solve this problem by keeping expenses organized and automatically calculating **individual shares, balances, and settlements**, making group expense management easier and more transparent.

---

## 📄 License

This project is developed for educational and academic purposes.
