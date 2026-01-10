# NEET Mentorship App

A comprehensive mentorship application designed for NEET exam preparation with role-based access control and real-time communication features.

## Features

### User Roles
- **Admin**: Complete control over users, groups, and quizzes
- **Mentor**: Group-specific access with chat and quiz viewing capabilities
- **Student**: Participation in assigned groups and quiz attempts

### Core Functionality
- ✅ JWT-based authentication
- ✅ Role-based permissions
- ✅ Real-time group chat (Socket.IO)
- ✅ Group management with bulk assignment
- ✅ Quiz creation and attempt system
- ✅ Audio calling capabilities (WebRTC)
- ✅ Clean, responsive UI design

## Tech Stack

### Frontend
- **React Native** with Expo Router
- **TypeScript** for type safety
- **Axios** for API communication
- **Socket.IO Client** for real-time features
- **Expo AV** for audio functionality

### Backend
- **Node.js** with Express.js
- **MongoDB** with Mongoose ODM
- **Socket.IO** for real-time communication
- **JWT** for authentication
- **bcryptjs** for password hashing

## Project Structure

```
├── app/                    # React Native frontend
│   ├── (tabs)/            # Tab-based navigation
│   ├── login.tsx          # Login screen
│   └── _layout.tsx        # Root layout
├── backend/               # Node.js backend
│   ├── models/           # Mongoose models
│   ├── routes/           # API routes
│   ├── middleware/       # Auth middleware
│   └── server.js         # Main server file
├── context/              # React contexts
├── services/             # API service layer
└── README.md
```

## Setup Instructions

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (local or cloud instance)
- Expo CLI
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file and configure environment variables:
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/neet-mentorship
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
NODE_ENV=development
```

4. Start MongoDB service on your machine

5. Start the backend server:
```bash
npm run dev
```

The backend server will run on `http://localhost:3000`

### Frontend Setup

1. In the root directory, install dependencies:
```bash
npm install
```

2. Update the API base URL in `services/api.ts` if needed:
```typescript
baseURL: 'http://localhost:3000/api', // Update if your backend runs on different port
```

3. Start the Expo development server:
```bash
npm run dev
```

4. Use Expo Go app on your mobile device or an emulator to run the application

## Default Admin Account

After setting up the backend, you'll need to create an admin account manually in MongoDB or use a database seeding script. Here's an example admin user:

```javascript
// Connect to MongoDB and insert this document in the 'users' collection
{
  name: "Admin User",
  email: "admin@example.com",
  password: "$2a$10$XYZ...", // Hash of "admin123"
  role: "admin",
  groups: [],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
}
```

## Usage Guide

### Admin Functions
1. **Login** with admin credentials
2. **Create Users**: Navigate to Users tab to create mentors and students
3. **Create Groups**: Use Groups tab to create new groups
4. **Assign Members**: Add mentors and students to groups in bulk
5. **Create Quizzes**: Design quizzes and assign them to groups

### Mentor Functions
1. **View Groups**: See only assigned groups
2. **Chat**: Participate in group discussions
3. **Monitor Quizzes**: View quiz results from students

### Student Functions
1. **Join Groups**: Access assigned groups
2. **Participate in Chat**: Communicate with mentors and peers
3. **Attempt Quizzes**: Take assigned quizzes and view scores

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Users
- `GET /api/users` - Get all users (Admin)
- `POST /api/users` - Create user (Admin)
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user

### Groups
- `GET /api/groups` - Get groups (role-based)
- `POST /api/groups` - Create group (Admin)
- `POST /api/groups/:id/members` - Add members (Admin)
- `DELETE /api/groups/:id/members/:userId` - Remove member (Admin)

### Messages
- `GET /api/messages/group/:groupId` - Get group messages
- `POST /api/messages` - Send message
- `DELETE /api/messages/:id` - Delete message

### Quizzes
- `GET /api/quizzes` - Get quizzes (role-based)
- `POST /api/quizzes` - Create quiz (Admin)
- `GET /api/quizzes/:id` - Get quiz details
- `POST /api/quizzes/:id/attempt` - Submit quiz attempt (Student)

## Real-time Features

The app uses Socket.IO for real-time communication:

### Chat Events
- `join_room` - Join a group chat room
- `leave_room` - Leave a group chat room
- `send_message` - Send a message to the group
- `receive_message` - Receive messages from other users

## Security Features

- **JWT Authentication**: Secure token-based authentication
- **Role-based Access Control**: Strict permission system
- **Password Hashing**: bcrypt for secure password storage
- **Input Validation**: Server-side validation for all endpoints
- **CORS Configuration**: Proper cross-origin request handling

## Development Notes

- The app uses a blue and white theme with black text for clean readability
- All components are functional components with React Hooks
- TypeScript is used throughout for type safety
- The backend uses proper error handling and validation
- Socket.IO enables real-time features without polling

## Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
   - Ensure MongoDB is running locally
   - Check connection string in `.env` file

2. **CORS Errors**
   - Verify API base URL in frontend
   - Check CORS configuration in backend

3. **Authentication Issues**
   - Ensure JWT secret is consistent
   - Check token storage and transmission

4. **Socket.IO Connection Problems**
   - Verify server is running
   - Check firewall settings

### Performance Tips

- Keep message history reasonable by implementing pagination
- Use MongoDB indexing for better query performance
- Implement message caching for frequently accessed data
- Consider implementing message compression for large groups

## License

This project is licensed under the MIT License.