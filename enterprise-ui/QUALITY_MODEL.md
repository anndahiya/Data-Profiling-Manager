# Configurable data quality model

The web application keeps two different measures visible:

- **Overall quality** is the weighted average of active rule pass rates within each dimension, followed by the weighted average of contributing dimension scores.
- **Strict record compliance** is the percentage of records that pass every active rule.

A failed rule or a zero-scoring dimension therefore lowers overall quality according to its configured weight; it does not automatically force the entire dataset score to zero.

The enabled standard starting dimensions are Accuracy, Completeness, Consistency, Timeliness, Uniqueness, and Validity. Currency, Referential integrity, Conformity, and Coverage are included as optional library dimensions. Users can enable, reweight, edit, or supplement these with organisation-specific dimensions.

Rules support required values, uniqueness, datatype, pattern, freshness, numeric range, allowed values, and minimum or maximum length. Every rule has its own score weight, issue threshold, and issue severity. Rule changes apply to future profiling runs because raw rows are not retained after browser-side profiling.
