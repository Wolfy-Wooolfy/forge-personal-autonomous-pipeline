## 18. Multi-Project Orchestration

The system must support multiple independent projects.

### 18.1 Isolation Principle

Each project must maintain independent:

* context
* state
* docs
* decisions
* artifacts
* execution history

No project may leak context into another project without explicit user request.

### 18.2 Project Switching

The interface must allow the user to:

* create a new project
* open an existing project
* switch among projects
* see status for each project

### 18.3 Parallel Handling

Projects may progress independently.
If multiple projects are active, each must show:

* current phase
* pending decisions
* whether blocked
* latest update

### 18.4 Group Operations

The system may support grouped review or grouped reporting across projects, but not mixed execution contexts unless explicitly designed.

---