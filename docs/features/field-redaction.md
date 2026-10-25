# Field Redaction Configuration

The Argos supports automatic redaction of sensitive fields in query results to protect privacy and comply with data protection regulations.

## Overview

Field redaction automatically masks, replaces, or partially obscures sensitive data in database query results before they are returned to Claude or other clients. This provides an additional layer of data protection without requiring application-level changes.

## Configuration

Add redaction configuration to any database section in your `config.ini` file:

### Basic Configuration

```ini
[database.production]
type=postgresql
host=prod-db.company.com
database=app_db
username=readonly_user
password=secure_pass

# Enable field redaction
redaction_enabled=true
redaction_rules=email:partial_mask,phone:full_mask,ssn:replace:[PROTECTED]
```

### Advanced Configuration

```ini
[database.production]
type=postgresql
host=prod-db.company.com
database=app_db
username=readonly_user
password=secure_pass

# Field Redaction Configuration
redaction_enabled=true

# Define redaction rules (field:type[:options])
redaction_rules=*email*:partial_mask,*phone*:full_mask,*ssn*:replace:[SSN_REDACTED],*password*:replace:[HIDDEN],customer_id:replace:[CUST_ID]

# Global settings
redaction_replacement_text=[REDACTED]
redaction_log_access=true
redaction_case_sensitive=false
redaction_audit_queries=true
```

## Configuration Options

### Core Settings

- **`redaction_enabled`**: Enable or disable redaction for this database (`true`/`false`)
- **`redaction_rules`**: Comma-separated list of field redaction rules
- **`redaction_replacement_text`**: Default replacement text for `replace` type redaction
- **`redaction_log_access`**: Log when redacted fields are accessed (`true`/`false`)
- **`redaction_case_sensitive`**: Whether field matching is case sensitive (`true`/`false`, default: `false`)
- **`redaction_audit_queries`**: Keep audit trail of queries accessing redacted data (`true`/`false`)

## Redaction Rules

Redaction rules follow the format: `field_pattern:redaction_type[:options]`

### Field Patterns

1. **Exact Match**: `email` - matches only fields named exactly "email"
2. **Wildcard Match**: `*email*` - matches any field containing "email" (e.g., "user_email", "email_address", "contact_email")
3. **Regex Match**: `/^user_.+$/` - matches fields using regular expressions (e.g., fields starting with "user_")

### Redaction Types

#### 1. Full Masking (`full_mask`)

Replaces the entire value with mask characters.

```ini
redaction_rules=phone:full_mask
```

**Examples:**
- `john@email.com` -> `*************`
- `555-123-4567` -> `************`
- `123-45-6789` -> `***********`

#### 2. Partial Masking (`partial_mask`)

Preserves format while masking content. Automatically detects data types (email, phone, generic).

```ini
redaction_rules=email:partial_mask,phone:partial_mask
```

**Examples:**
- `john.doe@example.com` -> `j******.e@*****.com`
- `555-123-4567` -> `***-***-4567`
- `sensitive_data` -> `s*********a`

#### 3. Fixed Replacement (`replace`)

Replaces values with fixed text.

```ini
redaction_rules=ssn:replace:[SSN_PROTECTED],password:replace:[HIDDEN]
```

**Examples:**
- `123-45-6789` -> `[SSN_PROTECTED]`
- `mypassword123` -> `[HIDDEN]`
- Any value -> `[REDACTED]` (if no replacement text specified)

#### 4. Custom Pattern (`custom`)

Uses regex patterns for advanced redaction.

```ini
redaction_rules=user_id:custom:\d+:[ID_HIDDEN]
```

**Examples:**
- `user_12345_profile` -> `user_[ID_HIDDEN]_profile`
- Custom patterns allow fine-grained control over redaction

## Complete Examples

### E-commerce Database

```ini
[database.ecommerce]
type=mysql
host=ecommerce-db.company.com
database=shop_db
username=readonly_user
password=secure_pass

# Redact customer PII
redaction_enabled=true
redaction_rules=*email*:partial_mask,*phone*:partial_mask,*address*:replace:[ADDRESS],*credit_card*:replace:[CARD],*ssn*:replace:[SSN]
redaction_log_access=true
```

### HR Database

```ini
[database.hr]
type=postgresql
host=hr-db.internal
database=hr_system
username=hr_readonly
password=hr_pass

# Comprehensive employee data protection
redaction_enabled=true
redaction_rules=email:partial_mask,*phone*:full_mask,ssn:replace:[SSN_REDACTED],salary:replace:[SALARY],*address*:replace:[ADDRESS],emergency_contact:replace:[CONTACT]
redaction_replacement_text=[PROTECTED]
redaction_log_access=true
redaction_audit_queries=true
```

### Analytics Database

```ini
[database.analytics]
type=mssql
host=analytics-server.com
database=data_warehouse
username=analyst_user
password=analyst_pass

# Protect customer identifiers while preserving analytics
redaction_enabled=true
redaction_rules=customer_email:partial_mask,*phone*:full_mask,user_id:replace:[USER_ID],session_id:replace:[SESSION]
redaction_case_sensitive=false
```

## How It Works

1. **Query Execution**: Queries execute normally against the database
2. **Result Processing**: Before returning results, the redaction manager examines each field
3. **Pattern Matching**: Field names are matched against configured redaction rules
4. **Value Redaction**: Matching fields have their values redacted according to the rule type
5. **Result Return**: Redacted results are returned to Claude/clients

## Benefits

- **Privacy Protection**: Automatically protects sensitive data without application changes
- **Compliance**: Helps meet data protection regulations (GDPR, HIPAA, etc.)
- **Flexibility**: Multiple redaction patterns for different data types
- **Performance**: Minimal overhead - only processes configured fields
- **Auditability**: Optional logging of redacted field access
- **Backwards Compatibility**: Opt-in feature that doesn't affect existing configurations

## Security Considerations

1. **Configuration Security**: Store config files securely as they define what data is sensitive
2. **Logging**: Be careful with redaction logs to avoid inadvertently logging sensitive data
3. **Rule Testing**: Test redaction rules thoroughly before production use
4. **Performance Impact**: Redaction adds minimal processing overhead per query
5. **Data Types**: Redacted values are returned as strings regardless of original data type

## Testing Redaction

You can test your redaction configuration using the interactive setup wizard or by examining query results. The system will show which fields were redacted and how many values were affected.

## Troubleshooting

### Common Issues

1. **Rules Not Applied**: Check field name spelling and pattern matching
2. **Case Sensitivity**: Ensure `redaction_case_sensitive` setting matches your field naming
3. **Wildcard Patterns**: Remember that `*email*` matches any field containing "email"
4. **Regex Patterns**: Validate regex syntax for custom patterns
5. **Performance**: Too many complex rules can impact query performance

### Debug Tips

- Enable `redaction_log_access=true` to see when redaction is applied
- Use the test functionality to verify rules work with sample data
- Start with simple exact matches before using wildcards or regex
- Check logs for redaction warnings or errors

## Best Practices

1. **Start Simple**: Begin with exact field matches before using wildcards
2. **Test Thoroughly**: Verify redaction works with real data samples
3. **Document Rules**: Keep track of which fields are redacted and why
4. **Regular Review**: Periodically review and update redaction rules
5. **Performance Monitoring**: Monitor query performance impact
6. **Compliance Alignment**: Ensure redaction rules meet your compliance requirements

## Integration with Claude

When redaction is enabled, Claude will automatically receive redacted data in query results. This provides seamless privacy protection during data analysis and conversation without requiring changes to how you interact with Claude.

The redacted data appears natural in conversation while protecting sensitive information, allowing for meaningful data analysis while maintaining privacy compliance.
