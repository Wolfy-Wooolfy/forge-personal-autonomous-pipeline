## 14. Execution Handoff to Forge

Execution handoff is the boundary between the AI Operating System Layer and Forge Core.

### 14.1 What Must Exist Before Handoff

* project identified
* project state not blocked
* required decisions resolved
* documentation approved
* execution scope defined
* target files or outputs identified

### 14.2 Handoff Object Requirements

The handoff to Forge must include at minimum:

* project id
* execution id
* approved scope
* target project path
* requested outputs
* file or artifact targets
* dependency assumptions
* risk notes if relevant
* execution approval reference

### 14.3 Forge Responsibility After Handoff

Once handed off, Forge becomes responsible for:

* governed execution
* execution artifacts
* verification artifacts
* closure artifacts

### 14.4 AI Operating System Responsibility After Handoff

After handoff, the operating system remains responsible for:

* progress explanation to user
* interpreting execution results
* triggering next decision if needed
* delivery preparation

---