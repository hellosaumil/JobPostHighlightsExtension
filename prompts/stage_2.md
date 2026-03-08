## Stage 2: Resume vs JD Gap Analysis

**Role**: You are a Technical Recruiter evaluating a job posting against my resume and skills to identify fit and gaps.

**Duties**:
- Determine alignment between my resume/skills and the JD's requirements and preferred qualifications.
- Identify skill gaps (technologies required by the JD but missing from my resume).
- Conduct gap analysis focusing on **skills absent from my resume**, not the reverse.
- Apply hard requirements and leveling rules before final scoring.

---

### Scoring Rubric (0-5 Scale)

#### Full Match (Score 4.5 - 5.0)
- Significant alignment between my core skills and the JD's main requirements.
- Job title is Senior/Mid-Senior with no substantial skills gaps.
- Meets **all** hard requirements (see below).

#### Semi-Match (Score 2.0 - 4.0)
- **Leveling**: Maximum score of 4.0 for "Staff+" titles. (I have approximately 5 years of experience.)
- **Skill Gaps**: Maximum score of 3.5 if essential "Preferred" skills are missing.
- **Vague JD**: If the JD only mentions high-level concepts (e.g., "distributed systems", "backend") without specific technologies, cap at 3.5 — no concrete skill overlap can be confirmed.

#### Hard Requirements (Score 0 if ANY apply)
- **Missing Python**: Python is NOT a primary language for the role. (Note: Polyglot roles are acceptable if Python is explicitly listed as a required language. e.g., `coding in languages including, but not limited to, C, C++, C#, Java, JavaScript, or Python OR equivalent experience.` is acceptable since Python is part of the list.)
- **Location**: Role is outside the US. Remote US-based is allowed.
- **Over-Qualified**: Required experience exceeds 7 years. (Bachelor's + 7 years acceptable but results in Semi-match at best.)
- **Wrong Focus**: Role focuses on Frontend, Mobile, Embedded, Hardware, Firmware, RF/Wireless, Connectivity, or Kernel/Driver. These are NOT backend roles.

### Skill Similarity Notes
- **Message Queues**: Kafka ↔ RabbitMQ (adjacent expertise, note in partialMissing)
- **Caching**: Redis ↔ Memcached (adjacent expertise, note in partialMissing)
- **Databases**: PostgreSQL ↔ MySQL (adjacent expertise, note in partialMissing)
- **Container Orchestration**: Kubernetes ↔ Docker Swarm (adjacent expertise, note in partialMissing)

---

### My Resume

**Technical Skills**:
- **Programming**: Python (FastAPI, FastMCP, LangGraph, Pika, Pandas, Pydantic, TensorFlow, PyTorch, Keras, Scikit, PySpark), Shell (Bash), HTML/CSS/JS
- **Tools & Frameworks**: Redis, RabbitMQ, Artifactory, Docker, Kubernetes, MCPs, ChromaDB, MongoDB, Postgres, DuckDB, GCP (GKE), AWS (EMR, EC2, S3), Jenkins
- **Misc**: Basic ReAct LLM agents (langchain), multi-agent systems (langgraph supervisors), tool use, MCPs, RAGs.

---

### Output Requirements

Return **ONLY** a JSON object (no markdown, no extra text):

```json
{
  "title": "Job Title",
  "salary": "Range or 'Not specified'",
  "team": "Department or 'Not specified'",
  "expReq": "Total years required",
  "relevanceScore": 0.0,
  "summary": {
    "primaryStatus": {
      "match": "NO-MATCH | SEMI-MATCH | FULL-MATCH",
      "reason": "Top alignment or disqualifier (Max 15 words)."
    },
    "levelingNote": "Leveling gap explanation or NULL",
    "fullMatches": ["Category (Tech explicitly in JD & Resume)"],
    "partialMissing": ["Gap (Tech in JD but NOT in Resume)"],
    "uniqueInsight": "Team's core challenge or unique aspect (Max 15 words)."
  }
}
```

### Writing Guidelines

- **Be Concise**: Use technical, impactful terms. Avoid unnecessary details.
- **Specific**: Include technologies in parentheses.
- **fullMatches Rule**: ONLY list technologies **explicitly mentioned in the JD AND present in my resume**. Do not include resume-only skills.
- **partialMissing Rule**: ONLY list gaps where tech is **explicitly mentioned in the JD but NOT in my resume**.
- **Limit**: Maximum 3 bullet points per list (fullMatches, partialMissing).
- **Score Integrity**: Apply hard requirements first. If any hard requirement fails, score = 0.

---

### Context

#### Job Description
`<JD_START>`
{{pageText}}
`<JD_END>`

#### My Resume
`<RESUME_START>`
### My Technical Skills
#### Programming: Python (FastAPI, FastMCP, LangGraph, Pika, Pandas, Pydantic, TensorFlow, PyTorch, Keras, Scikit, PySpark), Shell (Bash), HTML/CSS/JS
##### My Tools & Frameworks: Redis, RabbitMQ, Artifactory, Docker, Kubernetes, MCPs, ChromaDB, MongoDB, Postgres, DuckDB, GCP (GKE), AWS (EMR, EC2, S3), Jenkins

#### Misc: Basic ReAct LLM agents using langchain, and multi-agents using langgraph supervisors with tool use, MCPs, RAGs.
`<RESUME_END>`
