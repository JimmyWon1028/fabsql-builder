export class QueryHistory<Value> {
  private readonly undoStack: Value[] = []
  private readonly redoStack: Value[] = []
  private currentValue: Value

  public constructor(
    currentValue: Value,
    private readonly clone: (value: Value) => Value,
    private readonly maximumEntries = 100
  ) {
    this.currentValue = this.clone(currentValue)
  }

  public get current(): Value {
    return this.clone(this.currentValue)
  }

  public get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  public get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  public commit(nextValue: Value): Value {
    this.undoStack.push(this.clone(this.currentValue))

    if (this.undoStack.length > this.maximumEntries) {
      this.undoStack.splice(
        0,
        this.undoStack.length - this.maximumEntries
      )
    }

    this.currentValue = this.clone(nextValue)
    this.redoStack.length = 0
    return this.current
  }

  public replace(nextValue: Value): Value {
    this.currentValue = this.clone(nextValue)
    this.undoStack.length = 0
    this.redoStack.length = 0
    return this.current
  }

  public undo(): Value {
    if (this.undoStack.length === 0) {
      return this.current
    }

    const previousValue = this.undoStack.pop()!
    this.redoStack.push(this.clone(this.currentValue))
    this.currentValue = previousValue
    return this.current
  }

  public redo(): Value {
    if (this.redoStack.length === 0) {
      return this.current
    }

    const nextValue = this.redoStack.pop()!
    this.undoStack.push(this.clone(this.currentValue))
    this.currentValue = nextValue
    return this.current
  }
}
