---
name: infrastructure-drift-check
description: Detects infrastructure drift before merging IaC changes by diffing declared vs deployed state. Use when reviewing or merging Terraform .tf, Ansible, Kubernetes manifests, Helm, or Compose PRs.
---

# infrastructure-drift-check

Use this skill before merging infrastructure-as-code changes to ensure declared state is consistent with what is deployed.

## Triggers

- Changes to `*.tf` files (Terraform)
- Changes to Ansible playbooks or inventory
- Changes to Kubernetes manifests (`k8s/`, `manifests/`, `helm/`)
- Changes to Docker Compose files used in production
- Any IaC change targeting a production or staging environment

## Protocol

### Step 1 — Select the right workspace / environment

Before running any plan, confirm you are targeting the correct environment. A drift check against the wrong workspace produces false confidence.

```text
Terraform:  terraform workspace show   # must match the PR target env
Ansible:    ansible-inventory -i inventories/prod --list | head  # confirm hosts
Kubernetes: kubectl config current-context  # confirm cluster
```

If the workspace is wrong, stop. Do not proceed until confirmed.

### Step 2 — Run the plan and capture output

**Terraform:**

```bash
terraform plan -out=tfplan.binary 2>&1 | tee plan.txt
```

**Ansible:**

```bash
ansible-playbook site.yml -i inventories/prod --check --diff 2>&1 | tee ansible-check.txt
```

**Kubernetes:**

```bash
kubectl diff -f manifests/ 2>&1 | tee k8s-diff.txt
# or for Helm:
helm diff upgrade <release> <chart> -f values.prod.yaml 2>&1 | tee helm-diff.txt
```

### Step 3 — Interpret the output

```text
GOOD — plan matches only the PR changes:
  Terraform: "Plan: 1 to add, 0 to destroy, 0 to change" (where 1 is the new resource in the PR)
  Ansible:   All tasks report "ok" or "changed" only for the task introduced in the PR
  Kubernetes: diff shows only the fields changed in the PR

BAD — plan shows changes beyond the PR:
  Terraform: "Plan: 1 to add, 0 to destroy, 2 to change"
             -- 2 unexpected changes → drift exists in the deployed environment
  Ansible:   "changed" tasks beyond those in the PR
             -- Something was modified out-of-band on a host

  → If extra changes appear: document the out-of-band change, open a follow-up issue,
    and do NOT merge the PR until the drift is reconciled.
```

### Step 4 — Flag destroy and replacement operations immediately

```text
Terraform destroy/replace signals (require synchronous review before merge):
  - "will be destroyed"
  - "must be replaced"
  - "-/+ destroy and then create replacement"

Ansible dangerous signals:
  - Task deletes files or drops database objects
  - "This task will cause data loss" in the diff

Kubernetes:
  - Pod spec changes that cause a rolling restart on a stateful set
  - PersistentVolumeClaim deletion or storageClass change
```

If `terraform plan` proposes destroying a stateful resource (RDS, S3 bucket, EBS volume, managed queue): **stop immediately and request a synchronous review**. Data loss is not recoverable from a plan output.

### Step 5 — Document the result in the PR

Paste the plan summary into the PR description with a clear status label:

```text
✅ Drift check passed — plan matches only the changes in this PR.
   Resources: +1 to add, 0 to destroy, 0 to change.

❌ Drift check flagged — 2 unexpected changes detected.
   See attached plan.txt. Follow-up issue: #<N>. Do not merge until reconciled.
```

## Completion checklist

- [ ] Correct workspace / environment confirmed before running the plan
- [ ] Plan run and output captured to a file
- [ ] No changes beyond what the PR introduces
- [ ] No destroy or replacement operations without synchronous review approval
- [ ] Plan summary pasted into PR description with pass / flag status

## When NOT to use

- Local development or sandbox environments where drift is expected and acceptable
- Documentation-only or comment changes with no behavioral impact
- New environments being provisioned for the first time (no prior deployed state to diff against)
