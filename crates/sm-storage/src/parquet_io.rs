use anyhow::{Context, Result, bail};
use arrow_array::{Array, ArrayRef, Float32Array, Float64Array, RecordBatch};
use arrow_schema::{DataType, Field, Schema, SchemaRef};
use parquet::arrow::ArrowWriter;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::basic::{Compression, ZstdLevel};
use parquet::file::properties::WriterProperties;
use sm_core::{ChannelDef, Frame};
use std::collections::HashMap;
use std::fs::File;
use std::path::Path;
use std::sync::Arc;

/// Rows buffered before a row group is written (~30 s at 333 Hz).
const BATCH_ROWS: usize = 10_000;

pub struct SessionWriter {
    schema: SchemaRef,
    writer: ArrowWriter<File>,
    t: Vec<f64>,
    cols: Vec<Vec<f32>>,
    rows: u64,
}

impl SessionWriter {
    pub fn create(path: &Path, channels: &[ChannelDef]) -> Result<Self> {
        let mut fields = vec![Field::new("t", DataType::Float64, false)];
        fields.extend(
            channels
                .iter()
                .map(|c| Field::new(&c.name, DataType::Float32, false)),
        );
        let schema = Arc::new(Schema::new(fields));
        let props = WriterProperties::builder()
            .set_compression(Compression::ZSTD(ZstdLevel::try_new(3)?))
            .build();
        let file = File::create(path).with_context(|| format!("creating {}", path.display()))?;
        let writer = ArrowWriter::try_new(file, schema.clone(), Some(props))?;
        Ok(Self {
            schema,
            writer,
            t: Vec::with_capacity(BATCH_ROWS),
            cols: vec![Vec::with_capacity(BATCH_ROWS); channels.len()],
            rows: 0,
        })
    }

    pub fn push(&mut self, frame: &Frame) -> Result<()> {
        if frame.values.len() != self.cols.len() {
            bail!(
                "frame has {} values, session has {} channels",
                frame.values.len(),
                self.cols.len()
            );
        }
        self.t.push(frame.t);
        for (col, &v) in self.cols.iter_mut().zip(&frame.values) {
            col.push(v);
        }
        self.rows += 1;
        if self.t.len() >= BATCH_ROWS {
            self.flush_batch()?;
        }
        Ok(())
    }

    pub fn rows(&self) -> u64 {
        self.rows
    }

    fn flush_batch(&mut self) -> Result<()> {
        if self.t.is_empty() {
            return Ok(());
        }
        let mut arrays: Vec<ArrayRef> = Vec::with_capacity(self.cols.len() + 1);
        arrays.push(Arc::new(Float64Array::from(std::mem::take(&mut self.t))));
        for col in &mut self.cols {
            arrays.push(Arc::new(Float32Array::from(std::mem::take(col))));
        }
        let batch = RecordBatch::try_new(self.schema.clone(), arrays)?;
        self.writer.write(&batch)?;
        self.writer.flush()?;
        Ok(())
    }

    pub fn finish(mut self) -> Result<u64> {
        self.flush_batch()?;
        self.writer.close()?;
        Ok(self.rows)
    }
}

/// Timestamps and channel columns of a recording.
pub type Columns = (Vec<f64>, HashMap<String, Vec<f32>>);

pub fn read(path: &Path) -> Result<Columns> {
    let file = File::open(path).with_context(|| format!("opening {}", path.display()))?;
    let reader = ParquetRecordBatchReaderBuilder::try_new(file)
        .with_context(|| format!("{} is not a complete recording", path.display()))?
        .build()?;
    let mut t = Vec::new();
    let mut cols: HashMap<String, Vec<f32>> = HashMap::new();
    for batch in reader {
        let batch = batch?;
        let schema = batch.schema();
        for (field, col) in schema.fields().iter().zip(batch.columns()) {
            if field.name() == "t" {
                let arr = col
                    .as_any()
                    .downcast_ref::<Float64Array>()
                    .context("column t is not f64")?;
                t.extend_from_slice(arr.values());
            } else if let Some(arr) = col.as_any().downcast_ref::<Float32Array>() {
                debug_assert_eq!(arr.null_count(), 0);
                cols.entry(field.name().clone())
                    .or_default()
                    .extend_from_slice(arr.values());
            }
        }
    }
    Ok((t, cols))
}
